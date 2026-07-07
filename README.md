# openapi-spec-scorer

A customizable OpenAPI specification scoring framework built on top of
[Spectral](https://github.com/stoplightio/spectral). Ships with a sensible
default ruleset and lets your end users externalize their own custom rules
without you having to build a rule engine from scratch.

## Why it's structured this way

Spectral already has a first-class mechanism for layering rulesets: `extends`.
Instead of writing custom merge/override logic, this framework leans entirely
on that:

```
spectral:oas  (Spectral's built-in ruleset)
     ↑ extends
rulesets/base.ruleset.yaml   (your product's default rules)
     ↑ extends
<tenant's custom ruleset>    (end-user's rules — file upload or pasted YAML)
```

A user's custom ruleset can:
- add brand-new rules
- override the severity of an inherited rule (e.g. turn a `warn` into `error`)
- disable an inherited rule entirely (`rule-name: off`)

The **scoring** layer (`SpecScorer`) is separate from the linting layer. It
runs Spectral, then converts the list of lint results into a single 0–100
score using configurable severity weights — because "how many lint issues"
and "what score does that translate to" are different concerns, and you'll
likely want to tune the scoring formula independently of the rules.

## Install

```bash
npm install
npm run build
```

(Dependencies are listed in `package.json` — this environment doesn't have
network access to run the install for you, so run it in your own project.)

## Basic usage

```ts
import { SpecScorer } from 'openapi-spec-scorer';

// Uses the shipped base ruleset
const scorer = new SpecScorer();
const report = await scorer.score(openApiYamlOrJsonString);

console.log(report.score);   // e.g. 82.5
console.log(report.grade);   // 'B'
console.log(report.passed);  // true/false against passThreshold
console.log(report.issues);  // full list with rule, message, path, severity, points deducted
```

## Letting users add custom rules (the externalization feature)

Give users a way to submit a ruleset — either as a file upload or as raw
YAML/JSON text from a UI — and pass it straight through:

```ts
// A) User uploaded a ruleset file (e.g. saved per-tenant on disk / S3 then downloaded locally)
const scorer = new SpecScorer({ rulesetPath: '/tenants/acme/ruleset.yaml' });

// B) User pasted/edited rules in your product's UI (no file involved)
const scorer = new SpecScorer({
  rulesetContent: `
rules:
  operation-tags-required: off
  my-custom-rule:
    description: Paths must not end with a trailing slash
    severity: error
    given: "$.paths[*]~"
    then:
      function: pattern
      functionOptions:
        match: "^(?!.*/$).*$"
  `,
});
```

Both paths automatically inherit `rulesets/base.ruleset.yaml` (see
`extendsBasePath` in `rulesetLoader.ts`) unless the user's content already
declares its own `extends:` block — in which case theirs is respected as-is,
so advanced users can opt out of your defaults entirely if they want a
from-scratch ruleset.

See `examples/custom-ruleset.example.yaml` for a fully worked example
(disabling a rule, downgrading a rule's severity, adding two new rules).

## Tuning how violations translate into a score

```ts
const scorer = new SpecScorer({
  scoringConfig: {
    severityWeights: { error: 15, warn: 4, info: 1, hint: 0.5 }, // points deducted per issue
    ruleWeightOverrides: { 'operation-operationId-required': 25 }, // per-rule override
    maxDeductionPerRule: 30, // cap so one repeated rule can't dominate the score
    passThreshold: 75,       // score needed to be "passed"
  },
});
```

## Category breakdowns

`report.categoryBreakdown` groups deductions by category (documentation,
security, operational-hygiene, response-quality, ...) so you can show users
a radar chart or sub-scores instead of just one number. Map rule names to
categories via the `ruleCategories` option, or edit `defaultRuleCategories()`
in `src/scorer.ts`.

## Testing

```bash
npm install
npm test
```

`tests/scorer.test.ts` covers the library directly: default ruleset scoring,
custom-ruleset overrides (file-based and inline), and scoring-config behavior
(severity weights, pass threshold, deduction caps).

`tests/api.test.ts` covers the REST API (below) using `supertest`, which
calls the Express app in-memory — no server needs to be running for these
tests. It exercises the full tenant-ruleset lifecycle: save → validate →
score with it → delete, plus a path-traversal-attempt check on `tenantId`.

Add your own cases as you add rules: for every new rule in
`base.ruleset.yaml`, add a small spec snippet or extend `sample-spec.yaml`
so there's a test asserting it fires (and one asserting it doesn't fire on a
compliant spec) — this catches accidental regressions when the ruleset
changes.

## Two ways to integrate

**1. As a library, in-process** — if your product's backend is already
Node.js/TypeScript, `npm install` this package (or copy `src/` and
`rulesets/` in) and call `SpecScorer` directly, exactly as in
`examples/run-example.ts`. No network hop, no separate deployment.

**2. As a standalone HTTP service** — if your product is in another
language (Python, Java, Go, ...), or you just want scoring decoupled as its
own deployable unit, run `src/api` as a small REST API and call it over
HTTP. This is fully self-contained (Express + this scoring engine) and
deploys independently of your main product.

### Running the API locally

```bash
npm install
npm run dev:api        # ts-node, for local development
# or, for a production-style run:
npm run build && npm start
```

### Running the API in Docker

```bash
docker compose up --build
```

This builds the image (see `Dockerfile`, a two-stage Node 20 Alpine build)
and exposes the API on `http://localhost:3000`, persisting tenant custom
rulesets in a named volume so they survive restarts. Point your product's
backend at this container's URL (or put it behind your API gateway /
load balancer) and call it like any other internal microservice.

### API reference

| Method | Path                             | Body                        | Purpose |
|--------|----------------------------------|------------------------------|---------|
| GET    | `/health`                        | —                            | Liveness check |
| POST   | `/v1/score`                      | `{ spec, format?, tenantId? }` | Lint + score a spec. Uses the tenant's saved custom ruleset if `tenantId` is given and has one, otherwise the base ruleset. |
| POST   | `/v1/rulesets/validate`          | `{ content }`                | Validate ruleset YAML/JSON without saving it (for a "test my rules" button in your UI) |
| PUT    | `/v1/tenants/:tenantId/ruleset`  | `{ content }`                | Validate and persist a tenant's custom ruleset |
| GET    | `/v1/tenants/:tenantId/ruleset`  | —                            | Fetch a tenant's saved custom ruleset (404 if none) |
| DELETE | `/v1/tenants/:tenantId/ruleset`  | —                            | Remove a tenant's custom ruleset (reverts them to the base ruleset) |

Example calls:

```bash
# Score a spec with the default ruleset
curl -X POST http://localhost:3000/v1/score \
  -H 'Content-Type: application/json' \
  -d '{"spec": "openapi: 3.0.3\ninfo:\n  title: Test\n  version: 1.0.0\npaths: {}"}'

# Save a custom ruleset for tenant "acme"
curl -X PUT http://localhost:3000/v1/tenants/acme/ruleset \
  -H 'Content-Type: application/json' \
  -d '{"content": "rules:\n  operation-tags-required: off\n"}'

# Score using acme's custom ruleset
curl -X POST http://localhost:3000/v1/score \
  -H 'Content-Type: application/json' \
  -d '{"spec": "...", "tenantId": "acme"}'
```

Notes on the API's design choices, worth knowing before you extend it:
- `tenantId` is validated against `^[a-zA-Z0-9_-]+$` before touching the
  filesystem (`rulesetStore.ts`) — never let a raw user-supplied path reach
  `fs` calls, since that's how path traversal vulnerabilities happen.
- Rulesets are validated (actually loaded through Spectral, including
  resolving `extends`) *before* being persisted, so a broken custom ruleset
  a user pastes in never silently breaks scoring later — it's rejected at
  save time with a `422` and an error message.
- `scorerCache.ts` caches a built `SpecScorer` per tenant so the ruleset
  isn't re-bundled on every `/v1/score` call; it's invalidated automatically
  whenever a tenant's ruleset is saved or deleted. If you run multiple API
  instances behind a load balancer, this cache is per-instance/in-memory —
  fine for correctness (each instance reloads lazily), but if you want
  instant cross-instance cache invalidation you'll want a shared
  invalidation signal (e.g. pub/sub) instead of relying on each instance's
  own file read.
- There's no auth on these routes — add your product's existing
  auth middleware (API key, JWT, etc.) in front of `/v1/tenants/*` at
  minimum, since those routes write to disk.

## Running the example

```bash
npm run example
```

This lints `examples/sample-spec.yaml` three ways: with the default ruleset,
with the example tenant ruleset (file-based), and with an inline ruleset
string — printing the score, grade, issue counts, and category breakdown for
each, so you can see the externalization flow end-to-end.

## Files

```
rulesets/base.ruleset.yaml         Product default ruleset (extends spectral:oas)
src/types.ts                       Scoring config & report types
src/rulesetLoader.ts               Loads rulesets from file path or raw content
src/scorer.ts                      SpecScorer: runs Spectral, computes the score
src/index.ts                       Public exports
examples/custom-ruleset.example.yaml   Example of a user-authored custom ruleset
examples/sample-spec.yaml          Sample OpenAPI doc with intentional issues
examples/run-example.ts            End-to-end demo script
```

## Integrating into your product

- **Multi-tenant storage**: store each tenant's ruleset YAML (blob or DB
  text column) and write it to a temp file (or use `loadRulesetFromContent`)
  before scoring — Spectral's `extends` resolution needs a real file path on
  disk to resolve relative paths, which `loadRulesetFromContent` handles for
  you via a temp directory.
- **Validating a user's custom ruleset before saving it**: call
  `loadRulesetFromContent` (or `loadRulesetFromFile`) in a try/catch when the
  user saves their rules in your UI, so you can surface a "your custom rule
  has invalid syntax" error immediately rather than at scoring time.
- **Rule authoring UI**: since rules are just JSON-shaped objects
  (`given`, `then.field`, `then.function`, `severity`, ...), you can build a
  simple form-based rule builder in your product that emits this YAML/JSON
  under the hood rather than requiring users to hand-write Spectral syntax.
- **Custom JS functions**: for logic that JSONPath + built-in functions
  can't express, Spectral supports custom functions loaded via `extends`/
  ruleset bundling. If you want to expose "custom functions" as a
  no-code-required feature to end users, that's a bigger lift (you'd be
  running user-authored JS) — flag if you want that use case and it should
  be sandboxed accordingly.
