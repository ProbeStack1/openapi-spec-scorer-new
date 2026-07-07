import { Spectral, Document } from '@stoplight/spectral-core';
import { Json as JsonParser, Yaml as YamlParser } from '@stoplight/spectral-parsers';
import type { RulesetDefinition } from '@stoplight/spectral-core';
import {
  DEFAULT_SCORING_CONFIG,
  SEVERITY_MAP,
  ScoreIssue,
  ScoreReport,
  ScoringConfig,
  CategoryBreakdown,
} from './types';
import { DEFAULT_BASE_RULESET_PATH, loadRulesetFromFile, loadRulesetFromContent } from './rulesetLoader';

export interface SpecScorerOptions {
  /** Path to a ruleset file. Defaults to the product's base ruleset. */
  rulesetPath?: string;
  /** Inline ruleset YAML/JSON content, alternative to rulesetPath. */
  rulesetContent?: string;
  /** Scoring weights/thresholds. Merged over DEFAULT_SCORING_CONFIG. */
  scoringConfig?: Partial<ScoringConfig>;
  /** Maps a Spectral rule name -> category label, for the category breakdown. */
  ruleCategories?: Record<string, string>;
}

export class SpecScorer {
  private spectralPromise: Promise<Spectral>;
  private scoringConfig: ScoringConfig;
  private ruleCategories: Record<string, string>;
  private rulesetLabel: string;
  private options: SpecScorerOptions;

  constructor(options: SpecScorerOptions = {}) {
    this.options = options;
    this.scoringConfig = {
      ...DEFAULT_SCORING_CONFIG,
      ...options.scoringConfig,
      severityWeights: {
        ...DEFAULT_SCORING_CONFIG.severityWeights,
        ...options.scoringConfig?.severityWeights,
      },
    };
    this.ruleCategories = options.ruleCategories ?? defaultRuleCategories();
    this.rulesetLabel = options.rulesetPath ?? (options.rulesetContent ? '<inline>' : DEFAULT_BASE_RULESET_PATH);

    this.spectralPromise = this.buildSpectral(options);
  }

  private async buildSpectral(options: SpecScorerOptions, allowedRules?: string[]): Promise<Spectral> {
    const spectral = new Spectral();

    let ruleset: RulesetDefinition;
    if (options.rulesetContent) {
      ruleset = await loadRulesetFromContent(options.rulesetContent, {
        extendsBasePath: DEFAULT_BASE_RULESET_PATH,
      });
    } else {
      ruleset = await loadRulesetFromFile(options.rulesetPath ?? DEFAULT_BASE_RULESET_PATH, {
        extendsBasePath: DEFAULT_BASE_RULESET_PATH,
      });
    }

    const effectiveRuleset = filterRulesetDefinition(ruleset, allowedRules);
    console.log(
      'RULES:',
      Object.keys((effectiveRuleset as any).rules ?? {})
    );
    spectral.setRuleset(effectiveRuleset);
    return spectral;
  }

  /**
   * Lints and scores an OpenAPI document.
   * @param spec Either the raw spec text (YAML or JSON string) or a parsed JS object.
   * @param format Hint for parsing raw strings; ignored if `spec` is already an object.
   * @param allowedRules Optional array of rule names to apply. If provided, only issues from these rules are included.
   */
  async score(spec: string | object, format: 'yaml' | 'json' = 'yaml', allowedRules?: string[]): Promise<ScoreReport> {
    const spectral = allowedRules && allowedRules.length > 0
      ? await this.buildSpectral(this.options, allowedRules)
      : await this.spectralPromise;

    const document =
      typeof spec === 'string'
        ? new Document(spec, (format === 'json' ? JsonParser : YamlParser) as typeof JsonParser, 'spec')
        : new Document(JSON.stringify(spec, null, 2), JsonParser, 'spec');
    console.log(
      "RUNNING RULES:",
      Object.keys((spectral as any).rules ?? {})
    );
    const results = await spectral.run(document);

    const issues: ScoreIssue[] = results.map((r) => {
        const severity = SEVERITY_MAP[r.severity];
        const ruleName = String(r.code);
        const weight = this.scoringConfig.ruleWeightOverrides?.[ruleName] ?? this.scoringConfig.severityWeights[severity];
        const pointsDeducted = Math.min(weight, this.scoringConfig.maxDeductionPerRule ?? weight);

        return {
          code: ruleName,
          message: r.message,
          severity,
          path: r.path.join('.'),
          line: r.range?.start?.line !== undefined ? r.range.start.line + 1 : undefined,
          category: this.ruleCategories[ruleName],
          pointsDeducted,
        };
      });

    return this.buildReport(issues);
  }

  private buildReport(issues: ScoreIssue[]): ScoreReport {
    const totalDeduction = issues.reduce((sum, i) => sum + i.pointsDeducted, 0);
    const score = Math.max(0, Math.round((100 - totalDeduction) * 10) / 10);

    const issuesBySeverity = { error: 0, warn: 0, info: 0, hint: 0 };
    for (const i of issues) issuesBySeverity[i.severity]++;

    const categoryMap = new Map<string, CategoryBreakdown>();
    for (const i of issues) {
      const cat = i.category ?? 'uncategorized';
      const existing = categoryMap.get(cat) ?? { category: cat, issueCount: 0, pointsDeducted: 0 };
      existing.issueCount++;
      existing.pointsDeducted += i.pointsDeducted;
      categoryMap.set(cat, existing);
    }

    return {
      score,
      grade: toGrade(score),
      passed: score >= (this.scoringConfig.passThreshold ?? 70),
      totalIssues: issues.length,
      issuesBySeverity,
      issues,
      categoryBreakdown: [...categoryMap.values()].sort((a, b) => b.pointsDeducted - a.pointsDeducted),
      rulesetUsed: this.rulesetLabel,
    };
  }
}

export function filterRulesetDefinition(ruleset: RulesetDefinition, allowedRules?: string[]): RulesetDefinition {
  if (!allowedRules || allowedRules.length === 0) {
    return ruleset;
  }

  const normalizedAllowedRules = new Set(
    allowedRules
      .map((rule) => rule.trim().toLowerCase())
      .filter(Boolean),
  );

  const rulesetWithRules = ruleset as RulesetDefinition & { rules?: Record<string, unknown> };
  const filteredRules = Object.entries(rulesetWithRules.rules ?? {}).reduce<Record<string, unknown>>((acc, [ruleName, ruleDefinition]) => {
    if (normalizedAllowedRules.has(ruleName.toLowerCase())) {
      acc[ruleName] = normalizeRuleDefinition(ruleDefinition);
    }
    return acc;
  }, {});

  const baseDefinition = (ruleset as RulesetDefinition & { definition?: RulesetDefinition }).definition ?? ruleset;

  return {
    ...baseDefinition,
    rules: filteredRules,
  } as RulesetDefinition;
}

function normalizeRuleDefinition(ruleDefinition: unknown): unknown {
  if (
    ruleDefinition &&
    typeof ruleDefinition === 'object' &&
    'definition' in ruleDefinition &&
    (ruleDefinition as { definition?: unknown }).definition !== undefined
  ) {
    return (ruleDefinition as { definition: unknown }).definition;
  }

  return ruleDefinition;
}

function toGrade(score: number): ScoreReport['grade'] {
  if (score >= 90) return 'A';
  if (score >= 80) return 'B';
  if (score >= 70) return 'C';
  if (score >= 60) return 'D';
  return 'F';
}

function defaultRuleCategories(): Record<string, string> {
  return {
    'info-contact-required': 'documentation',
    'info-description-required': 'documentation',
    'operation-description-required': 'documentation',
    'operation-summary-required': 'documentation',
    'operation-operationId-required': 'operational-hygiene',
    'operation-tags-required': 'operational-hygiene',
    'operation-4xx-response': 'response-quality',
    'api-global-security-defined': 'security',
    'no-http-urls-in-servers': 'security',
  };
}
