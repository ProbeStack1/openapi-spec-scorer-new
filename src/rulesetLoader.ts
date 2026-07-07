import * as fs from 'fs';
import * as path from 'path';
import { bundleAndLoadRuleset } from '@stoplight/spectral-ruleset-bundler/with-loader';
import { fetch } from '@stoplight/spectral-runtime';
import type { RulesetDefinition } from '@stoplight/spectral-core';

export const DEFAULT_BASE_RULESET_PATH = path.resolve(
  __dirname,
  '..',
  'rulesets',
  'base.ruleset.yaml',
);

/**
 * Loads a Spectral ruleset from disk, resolving any `extends` chain
 * (e.g. a tenant's custom ruleset that extends the product's base ruleset,
 * which in turn extends spectral:oas).
 *
 * @param rulesetPath Absolute or relative path to a .yaml/.yml/.json ruleset file.
 */
export async function loadRulesetFromFile(
  rulesetPath: string,
  opts: { extendsBasePath?: string } = {},
): Promise<RulesetDefinition> {
  const resolved = path.resolve(rulesetPath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`Ruleset file not found: ${resolved}`);
  }

  const content = fs.readFileSync(resolved, 'utf8');
  if (opts.extendsBasePath && !/^\s*extends\s*:/m.test(content)) {
    const os = await import('os');
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spec-scorer-'));
    const filePath = path.join(tmpDir, path.basename(resolved));
    try {
      fs.writeFileSync(filePath, `extends:\n  - ${opts.extendsBasePath}\n${content}`, 'utf8');
      return bundleAndLoadRuleset(filePath, { fs, fetch }) as unknown as RulesetDefinition;
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }

  return bundleAndLoadRuleset(resolved, { fs, fetch }) as unknown as RulesetDefinition;
}

/**
 * Loads a ruleset from an in-memory YAML/JSON string instead of a file path.
 * Useful when a user submits a custom ruleset via an API request body rather
 * than uploading a file. Internally this writes to a temp file because
 * Spectral's bundler resolves `extends` relative to a real file path.
 */
export async function loadRulesetFromContent(
  content: string,
  opts: { extendsBasePath?: string; tmpDir?: string; filename?: string } = {},
): Promise<RulesetDefinition> {
  const os = await import('os');
  const tmpDir = opts.tmpDir ?? fs.mkdtempSync(path.join(os.tmpdir(), 'spec-scorer-'));
  const filename = opts.filename ?? 'custom.ruleset.yaml';
  const filePath = path.join(tmpDir, filename);

  // If the caller didn't already embed an `extends` pointing at the base
  // ruleset, splice one in so every user ruleset automatically inherits
  // the product defaults unless they intentionally omit it.
  let finalContent = content;
  if (opts.extendsBasePath && !/^\s*extends\s*:/m.test(content)) {
    finalContent = `extends:\n  - ${opts.extendsBasePath}\n${content}`;
  }

  fs.writeFileSync(filePath, finalContent, 'utf8');
  return loadRulesetFromFile(filePath);
}
