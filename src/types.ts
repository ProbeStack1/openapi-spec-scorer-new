import { DiagnosticSeverity } from '@stoplight/types';

/** Points deducted from 100 for each violation of a given severity. */
export interface SeverityWeights {
  error: number;
  warn: number;
  info: number;
  hint: number;
}

/** Optional per-rule weight overrides, keyed by Spectral rule name. */
export type RuleWeightOverrides = Record<string, number>;

export interface ScoringConfig {
  /** Points deducted per violation, by severity. */
  severityWeights: SeverityWeights;
  /** Override the deduction for specific rule names (takes precedence over severityWeights). */
  ruleWeightOverrides?: RuleWeightOverrides;
  /** Deductions are capped so one noisy rule can't tank the score to negative infinity. */
  maxDeductionPerRule?: number;
  /** Score (0-100) at or above which the spec is considered "passing". */
  passThreshold?: number;
}

export interface ScoreIssue {
  code: string; // Spectral rule name
  message: string;
  severity: keyof SeverityWeights;
  path: string; // JSON path as a string, e.g. "paths./users.get"
  line?: number;
  category?: string;
  pointsDeducted: number;
}

export interface CategoryBreakdown {
  category: string;
  issueCount: number;
  pointsDeducted: number;
}

export interface ScoreReport {
  score: number; // 0-100, floored at 0
  grade: 'A' | 'B' | 'C' | 'D' | 'F';
  passed: boolean;
  totalIssues: number;
  issuesBySeverity: Record<keyof SeverityWeights, number>;
  issues: ScoreIssue[];
  categoryBreakdown: CategoryBreakdown[];
  rulesetUsed: string;
}

export const SEVERITY_MAP: Record<DiagnosticSeverity, keyof SeverityWeights> = {
  0: 'error',
  1: 'warn',
  2: 'info',
  3: 'hint',
};

export const DEFAULT_SCORING_CONFIG: ScoringConfig = {
  severityWeights: {
    error: 10,
    warn: 3,
    info: 1,
    hint: 0.5,
  },
  maxDeductionPerRule: 30,
  passThreshold: 70,
};
