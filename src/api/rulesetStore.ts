import * as fs from 'fs';
import * as path from 'path';
import { loadRulesetFromContent, DEFAULT_BASE_RULESET_PATH } from '../rulesetLoader';

const TENANT_RULESET_DIR = process.env.RULESETS_DIR
  ? path.resolve(process.env.RULESETS_DIR)
  : path.resolve(__dirname, '..', '..', 'rulesets', 'tenants');

if (!fs.existsSync(TENANT_RULESET_DIR)) {
  fs.mkdirSync(TENANT_RULESET_DIR, { recursive: true });
}

/**
 * Only allow safe identifiers (alphanumeric, dash, underscore) as tenant IDs.
 * This is what stands between "user-supplied ruleset path" and a path-traversal
 * vulnerability — never let a raw user-supplied path reach the filesystem.
 */
function assertSafeTenantId(tenantId: string): void {
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(tenantId)) {
    throw new Error(`Invalid tenantId: "${tenantId}". Use only letters, numbers, - and _.`);
  }
}

function tenantRulesetPath(tenantId: string): string {
  assertSafeTenantId(tenantId);
  return path.join(TENANT_RULESET_DIR, `${tenantId}.ruleset.yaml`);
}

/**
 * Validates ruleset content by attempting to actually load it (this also
 * resolves the `extends` chain), then persists it if valid. Throws on
 * invalid YAML/JSON or invalid Spectral rule definitions.
 */
export async function saveTenantRuleset(tenantId: string, content: string): Promise<void> {
  // Validate first — never persist a ruleset that fails to load.
  await loadRulesetFromContent(content, { extendsBasePath: DEFAULT_BASE_RULESET_PATH });

  const filePath = tenantRulesetPath(tenantId);
  fs.writeFileSync(filePath, content, 'utf8');
}

export function getTenantRulesetPath(tenantId: string): string | null {
  const filePath = tenantRulesetPath(tenantId);
  return fs.existsSync(filePath) ? filePath : null;
}

export function getTenantRulesetContent(tenantId: string): string | null {
  const filePath = tenantRulesetPath(tenantId);
  return fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : null;
}

export function deleteTenantRuleset(tenantId: string): boolean {
  const filePath = tenantRulesetPath(tenantId);
  if (!fs.existsSync(filePath)) return false;
  fs.unlinkSync(filePath);
  return true;
}

/** Just validates content without persisting — useful for a "preview" endpoint. */
export async function validateRulesetContent(content: string): Promise<{ valid: true } | { valid: false; error: string }> {
  try {
    await loadRulesetFromContent(content, { extendsBasePath: DEFAULT_BASE_RULESET_PATH });
    return { valid: true };
  } catch (err) {
    return { valid: false, error: err instanceof Error ? err.message : String(err) };
  }
}
