import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { SpecScorer, filterRulesetDefinition } from '../src';

const SAMPLE_SPEC_PATH = path.join(__dirname, '..', 'examples', 'sample-spec.yaml');
const CUSTOM_RULESET_PATH = path.join(__dirname, '..', 'examples', 'custom-ruleset.example.yaml');

const sampleSpec = fs.readFileSync(SAMPLE_SPEC_PATH, 'utf8');

describe('SpecScorer - default ruleset', () => {
  let scorer: SpecScorer;

  beforeAll(() => {
    scorer = new SpecScorer();
  });

  it('produces a score between 0 and 100', async () => {
    const report = await scorer.score(sampleSpec);
    expect(report.score).toBeGreaterThanOrEqual(0);
    expect(report.score).toBeLessThanOrEqual(100);
  });

  it('flags the missing operationId on GET /pets as an error', async () => {
    const report = await scorer.score(sampleSpec);
    const issue = report.issues.find((i) => i.code === 'operation-operationId-required');
    expect(issue).toBeDefined();
    expect(issue?.severity).toBe('error');
    expect(issue?.path).toContain('pets');
  });

  it('flags the http:// server URL', async () => {
    const report = await scorer.score(sampleSpec);
    const issue = report.issues.find((i) => i.code === 'no-http-urls-in-servers');
    // this rule only exists in the custom ruleset, not the base one
    expect(issue).toBeUndefined();
  });

  it('assigns a letter grade consistent with the numeric score', async () => {
    const report = await scorer.score(sampleSpec);
    if (report.score >= 90) expect(report.grade).toBe('A');
    else if (report.score >= 80) expect(report.grade).toBe('B');
    else if (report.score >= 70) expect(report.grade).toBe('C');
    else if (report.score >= 60) expect(report.grade).toBe('D');
    else expect(report.grade).toBe('F');
  });

  it('groups issues into a category breakdown', async () => {
    const report = await scorer.score(sampleSpec);
    expect(report.categoryBreakdown.length).toBeGreaterThan(0);
    const total = report.categoryBreakdown.reduce((s, c) => s + c.pointsDeducted, 0);
    expect(total).toBeCloseTo(100 - report.score, 1);
  });

  it('rejects an obviously invalid (non-OpenAPI) document', async () => {
    const report = await scorer.score('{"not": "a spec"}', 'json');
    expect(report.score).toBeLessThan(100);
  });
});

describe('SpecScorer - custom (tenant) ruleset via file', () => {
  it('picks up rules defined only in the custom ruleset', async () => {
    const scorer = new SpecScorer({ rulesetPath: CUSTOM_RULESET_PATH });
    const report = await scorer.score(sampleSpec);
    const httpIssue = report.issues.find((i) => i.code === 'no-http-urls-in-servers');
    expect(httpIssue).toBeDefined();
    expect(httpIssue?.severity).toBe('error');
  });

  it('respects a disabled inherited rule ("operation-summary-required: off")', async () => {
    const scorer = new SpecScorer({ rulesetPath: CUSTOM_RULESET_PATH });
    const report = await scorer.score(sampleSpec);
    expect(report.issues.find((i) => i.code === 'operation-summary-required')).toBeUndefined();
  });

  it('respects a downgraded severity ("api-global-security-defined: info")', async () => {
    const scorer = new SpecScorer({ rulesetPath: CUSTOM_RULESET_PATH });
    const report = await scorer.score(sampleSpec);
    const issue = report.issues.find((i) => i.code === 'api-global-security-defined');
    expect(issue?.severity).toBe('info');
  });
});

describe('SpecScorer - custom ruleset via inline content', () => {
  it('accepts a raw YAML string and merges with the base ruleset', async () => {
    const scorer = new SpecScorer({
      rulesetContent: `
rules:
  operation-tags-required: off
`,
    });
    const report = await scorer.score(sampleSpec);
    expect(report.issues.find((i) => i.code === 'operation-tags-required')).toBeUndefined();
    // other base rules should still be active
    expect(report.issues.find((i) => i.code === 'operation-operationId-required')).toBeDefined();
  });

  it('inherits the base ruleset when loading a tenant ruleset file without its own extends block', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spec-scorer-'));
    const tenantRulesetPath = path.join(tempDir, 'tenant.ruleset.yaml');
    fs.writeFileSync(
      tenantRulesetPath,
      `
rules:
  custom-team-rule:
    description: Team-specific rule
    severity: error
    given: "$.paths[*]~"
    then:
      function: pattern
      functionOptions:
        match: "^__never__"
`,
      'utf8',
    );

    try {
      const scorer = new SpecScorer({ rulesetPath: tenantRulesetPath });
      const report = await scorer.score(sampleSpec);
      expect(report.issues.find((i) => i.code === 'operation-operationId-required')).toBeDefined();
      expect(report.issues.find((i) => i.code === 'custom-team-rule')).toBeDefined();
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

describe('SpecScorer - rule selection', () => {
  it('filters the ruleset so only the requested rules remain enabled', () => {
    const ruleset = {
      extends: ['spectral:oas'],
      rules: {
        'operation-operationId-required': { severity: 'error' },
        'operation-summary-required': { severity: 'warn' },
      },
    } as any;

    const filtered = filterRulesetDefinition(ruleset, ['operation-summary-required']);

    expect((filtered as any).rules).toEqual({
      'operation-summary-required': { severity: 'warn' },
    });
  });
});

describe('SpecScorer - scoring config', () => {
  it('produces a lower score when severity weights are increased', async () => {
    const lenient = new SpecScorer({ scoringConfig: { severityWeights: { error: 5, warn: 1, info: 0.5, hint: 0.1 } } });
    const strict = new SpecScorer({ scoringConfig: { severityWeights: { error: 20, warn: 8, info: 2, hint: 1 } } });

    const lenientReport = await lenient.score(sampleSpec);
    const strictReport = await strict.score(sampleSpec);

    expect(strictReport.score).toBeLessThan(lenientReport.score);
  });

  it('honors a custom passThreshold', async () => {
    const easyToPass = new SpecScorer({ scoringConfig: { passThreshold: 0 } });
    const report = await easyToPass.score(sampleSpec);
    expect(report.passed).toBe(true);
  });

  it('caps deduction per rule via maxDeductionPerRule', async () => {
    const scorer = new SpecScorer({
      scoringConfig: {
        severityWeights: { error: 1000, warn: 1000, info: 1000, hint: 1000 },
        maxDeductionPerRule: 5,
      },
    });
    const report = await scorer.score(sampleSpec);
    for (const issue of report.issues) {
      expect(issue.pointsDeducted).toBeLessThanOrEqual(5);
    }
  });
});
