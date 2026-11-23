// EN: tests for the S1 client: the caller's token is forwarded, and S1 answers become our errors.
// Franco: tests le client S1: token el caller bey-etba3at, w radd S1 beyetghayyar le errors bta3etna.
const test = require('node:test');
const assert = require('node:assert');
const { createUpstream } = require('../src/upstream');

const ok = (body) => async () => ({ ok: true, status: 200, json: async () => body });
const status = (code) => async () => ({ ok: false, status: code, json: async () => ({}) });

test('getMe forwards the Bearer token and X-Request-Id, and uses the S1 URL', async () => {
  let seen;
  const up = createUpstream({ s1Url: 'http://s1:5001', fetchImpl: async (url, opts) => { seen = { url, opts }; return ok({ id: 'e1' })(); } });
  const me = await up.getMe({ token: 'a.b.c', requestId: 'req-12345678' });
  assert.strictEqual(me.id, 'e1');
  assert.strictEqual(seen.url, 'http://s1:5001/api/employees/me');
  assert.strictEqual(seen.opts.headers.Authorization, 'Bearer a.b.c');
  assert.strictEqual(seen.opts.headers['X-Request-Id'], 'req-12345678');
});

test('S1 answers: 404 -> 404, 401 -> 401, 500 -> 502, network error -> 503', async () => {
  const ctx = { token: 'a.b.c', requestId: 'r' };
  const run = (fetchImpl) => createUpstream({ fetchImpl }).getTraining('30000000-0000-4000-8000-000000000001', ctx);
  await assert.rejects(run(status(404)), (e) => e.status === 404 && /Training/.test(e.message));
  await assert.rejects(run(status(401)), (e) => e.status === 401);
  await assert.rejects(run(status(500)), (e) => e.status === 502);
  await assert.rejects(run(async () => { throw new Error('connect ECONNREFUSED'); }), (e) => e.status === 503);
});

test('the id is URL-encoded, so it cannot change the path', async () => {
  let url;
  const up = createUpstream({ fetchImpl: async (u) => { url = u; return ok({})(); } });
  await up.getTraining('../teams', { token: 't', requestId: 'r' });
  assert.ok(url.endsWith('/api/trainings/..%2Fteams'));
});

test('getEmployee, getTeams and getTeamEmployees call the right S1 paths and pass 403/404 on', async () => {
  const urls = [];
  const up = createUpstream({ s1Url: 'http://s1:5001', fetchImpl: async (u) => { urls.push(u); return ok([])(); } });
  const ctx = { token: 't', requestId: 'r' };
  await up.getEmployee('20000000-0000-4000-8000-000000000002', ctx);
  await up.getTeams(ctx);
  await up.getTeamEmployees('10000000-0000-4000-8000-000000000001', ctx);
  assert.deepStrictEqual(urls, [
    'http://s1:5001/api/employees/20000000-0000-4000-8000-000000000002',
    'http://s1:5001/api/teams',
    'http://s1:5001/api/teams/10000000-0000-4000-8000-000000000001/employees',
  ]);
  await assert.rejects(createUpstream({ fetchImpl: status(403) }).getTeamEmployees('x', ctx), (e) => e.status === 403);
  await assert.rejects(createUpstream({ fetchImpl: status(404) }).getTeamEmployees('x', ctx), (e) => e.status === 404);
});

test('getTeamCompletedAssignments asks S1 for status=completed', async () => {
  let url;
  const up = createUpstream({ s1Url: 'http://s1:5001', fetchImpl: async (u) => { url = u; return ok([])(); } });
  await up.getTeamCompletedAssignments('10000000-0000-4000-8000-000000000001', { token: 't', requestId: 'r' });
  assert.strictEqual(url, 'http://s1:5001/api/teams/10000000-0000-4000-8000-000000000001/assignments?status=completed');
});
