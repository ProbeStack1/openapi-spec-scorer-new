import { SpecScorer } from '../scorer';
import { getTenantRulesetPath } from './rulesetStore';

const cache = new Map<string, SpecScorer>();

/**
 * Returns a SpecScorer for the given tenant (or the default one if tenantId
 * is omitted / has no custom ruleset saved), reusing a cached instance so
 * we don't re-parse and re-bundle the ruleset on every HTTP request.
 *
 * Call `invalidate(tenantId)` whenever a tenant's ruleset is updated.
 */
export function getScorerForTenant(tenantId?: string): SpecScorer {
  const key = tenantId ?? '__default__';
  const cached = cache.get(key);
  if (cached) return cached;

  const rulesetPath = tenantId ? getTenantRulesetPath(tenantId) ?? undefined : undefined;
  const scorer = new SpecScorer({ rulesetPath });
  cache.set(key, scorer);
  return scorer;
}

export function invalidateScorerCache(tenantId: string): void {
  cache.delete(tenantId);
}
