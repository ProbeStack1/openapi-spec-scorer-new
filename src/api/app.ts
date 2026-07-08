import express, { Request, Response, NextFunction } from 'express';
import { getScorerForTenant, invalidateScorerCache } from './scorerCache';
import { saveTenantRuleset, getTenantRulesetContent, deleteTenantRuleset, validateRulesetContent } from './rulesetStore';

export function createApp() {
  const app = express();

  app.use((req: Request, res: Response, next: NextFunction) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');

    if (req.method === 'OPTIONS') {
      return res.status(204).send();
    }

    next();
  });

  app.use(express.json({ limit: '2mb' })); // specs can be large; adjust as needed

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  /**
   * POST /v1/score
   * Body: {
   *   spec: string | object,       // required — YAML/JSON text or a parsed object
   *   format?: 'yaml' | 'json',    // default 'yaml', ignored if spec is an object
   *   tenantId?: string            // optional — use a saved custom ruleset for this tenant
   *   rules?: string               // optional — comma-separated rule names to apply (e.g., "rule-name-1, rule-name-2")
   * }
   */
  app.post('/v1/score', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { spec, format, tenantId, rules } = req.body ?? {};
      if (!spec) {
        return res.status(400).json({ error: "Missing required field 'spec'." });
      }
      const scorer = getScorerForTenant(tenantId);
      // Parse comma-separated rules if provided
      const allowedRules = Array.isArray(rules)
        ? rules.map((r: string) => r.trim()).filter(Boolean)
        : typeof rules === 'string'
          ? rules.split(',').map((r: string) => r.trim()).filter(Boolean)
          : undefined;
      const report = await scorer.score(spec, format === 'json' ? 'json' : 'yaml', allowedRules);
      res.json(report);
    } catch (err) {
      next(err);
    }
  });

  /**
   * POST /v1/rulesets/validate
   * Body: { content: string }
   * Validates a ruleset (against the base ruleset) WITHOUT persisting it.
   * Use this for live-preview / "check my rules before saving" in your UI.
   */
  app.post('/v1/rulesets/validate', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { content } = req.body ?? {};
      if (!content) return res.status(400).json({ error: "Missing required field 'content'." });
      const result = await validateRulesetContent(content);
      res.status(result.valid ? 200 : 422).json(result);
    } catch (err) {
      next(err);
    }
  });

  /**
   * PUT /v1/tenants/:tenantId/ruleset
   * Body: { content: string }
   * Validates and persists a tenant's custom ruleset, then invalidates the
   * cached scorer so the next /v1/score call picks up the new rules.
   */
  app.put('/v1/tenants/:tenantId/ruleset', async (req: Request, res: Response) => {
    try {
      const { tenantId } = req.params;
      const { content } = req.body ?? {};
      if (!content) return res.status(400).json({ error: "Missing required field 'content'." });

      await saveTenantRuleset(tenantId, content);
      invalidateScorerCache(tenantId);
      res.status(204).send();
    } catch (err) {
      if (err instanceof Error && /Invalid tenantId/.test(err.message)) {
        return res.status(400).json({ error: err.message });
      }
      // Ruleset failed to load/validate -> 422, don't 500 on user input errors
      res.status(422).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.get('/v1/tenants/:tenantId/ruleset', (req: Request, res: Response) => {
    const content = getTenantRulesetContent(req.params.tenantId);
    if (!content) return res.status(404).json({ error: 'No custom ruleset saved for this tenant.' });
    res.type('text/yaml').send(content);
  });

  app.delete('/v1/tenants/:tenantId/ruleset', (req: Request, res: Response) => {
    const deleted = deleteTenantRuleset(req.params.tenantId);
    invalidateScorerCache(req.params.tenantId);
    res.status(deleted ? 204 : 404).send();
  });

  // Centralized error handler — keeps internal error details out of the response.
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    console.error(err);
    res.status(500).json({ error: 'Internal server error while scoring the specification.' });
  });

  return app;
}
