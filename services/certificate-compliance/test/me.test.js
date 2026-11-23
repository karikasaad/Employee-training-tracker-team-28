// EN: API tests for GET /api/certificates/me: only the caller's own certificates, and every error code.
// Franco: API tests le GET /api/certificates/me: el certificates bta3et el caller bas, w kol error code.
const test = require('node:test');
const assert = require('node:assert');
const { notFound } = require('../../common/errors');
const {
  EMPLOYEE_ID, TRAINING_ID, tokens, startApp, upstreamUnavailable,
} = require('../test-support/helpers');

async function withApp(fn) {
  const ctx = await startApp();
  try { await fn(ctx); } finally { await ctx.close(); }
}
const get = (ctx, auth = tokens.employee(), query = '') => fetch(`${ctx.url}/api/certificates/me${query}`, {
  headers: auth ? { Authorization: `Bearer ${auth}` } : {},
});

// EN: a database row as Postgres returns it (snake_case, dates already text).
// Franco: satr database zay ma Postgres beyrga3o (snake_case, el dates text).
function row(over = {}) {
  return {
    id: '50000000-0000-4000-8000-000000000001', employee_id: EMPLOYEE_ID, training_id: TRAINING_ID,
    title: 'Fire Safety Certificate', issuer: 'Seed Training Institute', certificate_number: 'FS-1001',
    issue_date: '2026-09-18', expiry_date: '2027-09-18', review_status: 'Verified', mime_type: 'application/pdf',
    size_bytes: 120000, uploaded_at: new Date('2026-09-18T10:00:00Z'), verified_by: '20000000-0000-4000-8000-000000000001',
    verified_at: new Date('2026-09-19T11:00:00Z'), reject_reason: null, s3_key: 'certificates/secret-key', file_hash: 'a'.repeat(64),
    ...over,
  };
}

test('200: returns my certificates in the contract shape, with validity, and no s3Key or fileHash', async () => {
  await withApp(async (ctx) => {
    ctx.pool.selectRows = [
      row(),
      row({ id: '50000000-0000-4000-8000-000000000002', expiry_date: '2026-12-10', review_status: 'Pending', verified_by: null, verified_at: null }),
      row({ id: '50000000-0000-4000-8000-000000000003', expiry_date: '2026-11-01' }),
    ];
    const res = await get(ctx);
    const body = await res.json();
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(body.map((c) => c.validity), ['Valid', 'Expiring soon', 'Expired']);
    assert.strictEqual(body[0].reviewStatus, 'Verified');
    assert.strictEqual(body[0].uploadedAt, '2026-09-18T10:00:00.000Z');
    assert.ok(body.every((c) => !('s3Key' in c) && !('fileHash' in c) && !('s3_key' in c)));
  });
});

test('200: the query uses the employee id from S1 (the token), never from the URL', async () => {
  await withApp(async (ctx) => {
    const res = await get(ctx, tokens.employee(), '?employeeId=20000000-0000-4000-8000-000000000003');
    assert.strictEqual(res.status, 200);
    const select = ctx.pool.calls.find((c) => /^\s*SELECT/i.test(c.sql));
    assert.deepStrictEqual(select.params, [EMPLOYEE_ID]);
    assert.match(select.sql, /deleted_at IS NULL/);
  });
});

test('200: a Manager sees their own list too; an empty list is []', async () => {
  await withApp(async (ctx) => {
    const res = await get(ctx, tokens.manager());
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(await res.json(), []);
  });
});

test('401: no token and expired token; 403: Service token', async () => {
  await withApp(async (ctx) => {
    assert.strictEqual((await get(ctx, null)).status, 401);
    assert.strictEqual((await get(ctx, tokens.expired())).status, 401);
    assert.strictEqual((await get(ctx, tokens.service())).status, 403);
    assert.strictEqual(ctx.pool.calls.length, 0);
  });
});

test('404: the user has no employee profile; 503: S1 is down', async () => {
  await withApp(async (ctx) => {
    ctx.upstream.meError = notFound('No employee profile exists for this user');
    assert.strictEqual((await get(ctx)).status, 404);
    ctx.upstream.meError = upstreamUnavailable('S1 is unavailable');
    assert.strictEqual((await get(ctx)).status, 503);
  });
});
