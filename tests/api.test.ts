import * as fs from 'fs';
import * as path from 'path';
import request from 'supertest';
import { createApp } from '../src/api/app';

const sampleSpec = fs.readFileSync(path.join(__dirname, '..', 'examples', 'sample-spec.yaml'), 'utf8');
const app = createApp();

describe('GET /health', () => {
  it('returns ok', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });
});

describe('POST /v1/score', () => {
  it('returns 400 when spec is missing', async () => {
    const res = await request(app).post('/v1/score').send({});
    expect(res.status).toBe(400);
  });

  it('scores a spec with the default ruleset', async () => {
    const res = await request(app).post('/v1/score').send({ spec: sampleSpec, format: 'yaml' });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('score');
    expect(res.body).toHaveProperty('grade');
    expect(res.body).toHaveProperty('issues');
    expect(Array.isArray(res.body.issues)).toBe(true);
  });
});

describe('POST /v1/rulesets/validate', () => {
  it('rejects invalid ruleset YAML', async () => {
    const res = await request(app)
      .post('/v1/rulesets/validate')
      .send({ content: 'rules: [this is not valid: yaml: syntax' });
    expect(res.status).toBe(422);
    expect(res.body.valid).toBe(false);
  });

  it('accepts a valid custom ruleset', async () => {
    const res = await request(app)
      .post('/v1/rulesets/validate')
      .send({ content: 'rules:\n  operation-tags-required: off\n' });
    expect(res.status).toBe(200);
    expect(res.body.valid).toBe(true);
  });
});

describe('Tenant ruleset lifecycle', () => {
  const tenantId = 'test-tenant-1';

  afterAll(async () => {
    await request(app).delete(`/v1/tenants/${tenantId}/ruleset`);
  });

  it('saves, uses, and deletes a tenant custom ruleset end-to-end', async () => {
    // 1) Save a custom ruleset that disables an inherited rule.
    const saveRes = await request(app)
      .put(`/v1/tenants/${tenantId}/ruleset`)
      .send({ content: 'rules:\n  operation-tags-required: off\n' });
    expect(saveRes.status).toBe(204);

    // 2) Fetch it back.
    const getRes = await request(app).get(`/v1/tenants/${tenantId}/ruleset`);
    expect(getRes.status).toBe(200);
    expect(getRes.text).toContain('operation-tags-required');

    // 3) Score using this tenant's ruleset — the disabled rule shouldn't fire.
    const scoreRes = await request(app).post('/v1/score').send({ spec: sampleSpec, tenantId });
    expect(scoreRes.status).toBe(200);
    const hasTagsIssue = scoreRes.body.issues.some((i: { code: string }) => i.code === 'operation-tags-required');
    expect(hasTagsIssue).toBe(false);

    // 4) Delete it.
    const deleteRes = await request(app).delete(`/v1/tenants/${tenantId}/ruleset`);
    expect(deleteRes.status).toBe(204);
    const getAfterDelete = await request(app).get(`/v1/tenants/${tenantId}/ruleset`);
    expect(getAfterDelete.status).toBe(404);
  });

  it('rejects an unsafe tenantId (path traversal attempt)', async () => {
    const res = await request(app)
      .put('/v1/tenants/..%2F..%2Fetc/ruleset')
      .send({ content: 'rules: {}' });
    expect([400, 404]).toContain(res.status);
  });
});
