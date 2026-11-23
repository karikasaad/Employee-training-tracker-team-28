// EN: tests for GET /api/compliance/teams/{teamId} (5.9): the rules (pure function), the API (success and every
//     error code) and a CONTRACT test: the real Service 3 reader (flagsFromContract) understands our answer.
// Franco: tests le GET /api/compliance/teams/{teamId} (5.9): el rules (function nadeefa) w el API (el nagah w kol
//     error code) w test lel CONTRACT: el reader el 7a2i2i bta3 Service 3 (flagsFromContract) beyefham radena.
const test = require('node:test');
const assert = require('node:assert');
const { buildTeamCompliance } = require('../src/compliance');
const { IDS, tokens, startApp, upstreamUnavailable } = require('../test-support/helpers');
const { upstreamError } = require('../../common/errors');
const { flagsFromContract } = require('../../dashboard-reports/src/compliance');

const TODAY = '2026-11-23';
const NOW = '2026-11-23T12:00:00.000Z';
const T_FIRE = '30000000-0000-4000-8000-000000000001';
const T_PRIVACY = '30000000-0000-4000-8000-000000000002';
const T_SAFETY = '30000000-0000-4000-8000-000000000003';
const T_NOCERT = '30000000-0000-4000-8000-000000000004';

// EN: a certificate row from the database. / Franco: satr certificate men el database.
function cert(id, employee, training, status, expiry) {
  return {
    id, employee_id: employee, training_id: training, review_status: status, issue_date: '2025-01-01', expiry_date: expiry,
    title: 't', issuer: 'i', certificate_number: null, mime_type: 'application/pdf', size_bytes: 1,
    uploaded_at: new Date('2026-01-01T00:00:00Z'), verified_by: null, verified_at: null, reject_reason: null, s3_key: 'certificates/secret-key',
  };
}
const done = (employeeId, trainingId, requiresCertificate = true) => ({ employeeId, trainingId, requiresCertificate, completedAt: '2026-10-01T10:00:00.000Z', category: 'Safety' });
const people = [{ id: IDS.MONA }, { id: IDS.AHMED }, { id: IDS.SARA }];
const build = (extra) => buildTeamCompliance({ teamId: IDS.OPS, employees: people, certRows: [], assignments: [], today: TODAY, nowIso: NOW, ...extra });
const flagsOf = (result, employeeId) => result.employees.find((e) => e.employeeId === employeeId).flags;

// =================================================================== the rules
test('rules: completed training that needs a certificate and has none -> Missing', () => {
  const r = build({ assignments: [done(IDS.AHMED, T_FIRE)] });
  assert.deepStrictEqual(flagsOf(r, IDS.AHMED), [{ flagType: 'Missing', trainingId: T_FIRE, certificateId: null, raisedAt: NOW }]);
  assert.deepStrictEqual(flagsOf(r, IDS.SARA), []);
});

test('rules: a Verified certificate that is still valid, or expires today, gives no flag', () => {
  const r = build({
    assignments: [done(IDS.AHMED, T_FIRE), done(IDS.SARA, T_FIRE)],
    certRows: [cert('c1', IDS.AHMED, T_FIRE, 'Verified', '2027-01-01'), cert('c2', IDS.SARA, T_FIRE, 'Verified', TODAY)],
  });
  assert.deepStrictEqual(flagsOf(r, IDS.AHMED), []);
  assert.deepStrictEqual(flagsOf(r, IDS.SARA), []);
});

test('rules: only Verified certificates count: Pending and Rejected still give Missing', () => {
  const r = build({
    assignments: [done(IDS.AHMED, T_FIRE), done(IDS.SARA, T_FIRE)],
    certRows: [cert('c1', IDS.AHMED, T_FIRE, 'Pending', '2030-01-01'), cert('c2', IDS.SARA, T_FIRE, 'Rejected', '2030-01-01')],
  });
  assert.strictEqual(flagsOf(r, IDS.AHMED)[0].flagType, 'Missing');
  assert.strictEqual(flagsOf(r, IDS.SARA)[0].flagType, 'Missing');
});

test('rules: Verified but all expired -> Expired, pointing to the NEWEST certificate', () => {
  const r = build({
    assignments: [done(IDS.AHMED, T_FIRE)],
    certRows: [cert('old', IDS.AHMED, T_FIRE, 'Verified', '2025-06-01'), cert('newest', IDS.AHMED, T_FIRE, 'Verified', '2026-11-22')],
  });
  assert.deepStrictEqual(flagsOf(r, IDS.AHMED), [{ flagType: 'Expired', trainingId: T_FIRE, certificateId: 'newest', raisedAt: NOW }]);
});

test('rules: an old expired certificate does not matter when a newer one is valid', () => {
  const r = build({
    assignments: [done(IDS.AHMED, T_FIRE)],
    certRows: [cert('old', IDS.AHMED, T_FIRE, 'Verified', '2025-06-01'), cert('new', IDS.AHMED, T_FIRE, 'Verified', '2027-06-01')],
  });
  assert.deepStrictEqual(flagsOf(r, IDS.AHMED), []);
});

test('rules: a training that does not need a certificate never gives a flag; a training counted once even if completed twice', () => {
  const r = build({ assignments: [done(IDS.AHMED, T_NOCERT, false), done(IDS.SARA, T_SAFETY), done(IDS.SARA, T_SAFETY)] });
  assert.deepStrictEqual(flagsOf(r, IDS.AHMED), []);
  assert.strictEqual(flagsOf(r, IDS.SARA).length, 1);
});

test('rules: raisedAt is kept from the flag that is already open in our table', () => {
  const r = build({
    assignments: [done(IDS.AHMED, T_FIRE)],
    openFlagRows: [{ employee_id: IDS.AHMED, training_id: T_FIRE, flag_type: 'Missing', raised_at: new Date('2026-11-01T01:00:00Z') }],
  });
  assert.strictEqual(flagsOf(r, IDS.AHMED)[0].raisedAt, '2026-11-01T01:00:00.000Z');
});

test('rules: certificates list has the contract fields, all statuses, validity, and never s3Key', () => {
  const r = build({
    certRows: [cert('c1', IDS.AHMED, T_FIRE, 'Verified', '2026-12-02'), cert('c2', IDS.AHMED, T_PRIVACY, 'Pending', '2027-06-01'), cert('c3', IDS.AHMED, T_SAFETY, 'Rejected', '2026-01-01')],
  });
  const certs = r.employees.find((e) => e.employeeId === IDS.AHMED).certificates;
  assert.deepStrictEqual(certs[0], { certificateId: 'c1', trainingId: T_FIRE, reviewStatus: 'Verified', expiryDate: '2026-12-02', validity: 'Expiring soon' });
  assert.deepStrictEqual(certs.map((c) => c.validity), ['Expiring soon', 'Valid', 'Expired']);
  assert.ok(!JSON.stringify(r).includes('secret-key'));
});

// =================================================================== the API
async function withApp(fn) {
  const ctx = await startApp();
  try { await fn(ctx); } finally { await ctx.close(); }
}
const get = (ctx, teamId = IDS.OPS, auth = tokens.mona()) => fetch(`${ctx.url}/api/compliance/teams/${teamId}`, {
  headers: auth ? { Authorization: `Bearer ${auth}` } : {},
}).then(async (res) => ({ status: res.status, body: await res.json() }));

test('200: the manager of the team gets every employee with certificates and flags', async () => {
  await withApp(async (ctx) => {
    ctx.upstream.assignments = [done(IDS.AHMED, T_FIRE), done(IDS.SARA, T_PRIVACY)];
    ctx.pool.selectRows = [cert('c1', IDS.SARA, T_PRIVACY, 'Verified', '2026-01-01')];
    const res = await get(ctx);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.teamId, IDS.OPS);
    assert.deepStrictEqual(res.body.employees.map((e) => e.employeeId), [IDS.MONA, IDS.AHMED, IDS.SARA]);
    assert.strictEqual(flagsOf(res.body, IDS.AHMED)[0].flagType, 'Missing');
    assert.deepStrictEqual(flagsOf(res.body, IDS.SARA).map((f) => [f.flagType, f.certificateId]), [['Expired', 'c1']]);
    assert.strictEqual(flagsOf(res.body, IDS.AHMED)[0].raisedAt, NOW);
    assert.ok(!JSON.stringify(res.body).includes('secret-key'));
  });
});

test('200: the caller\'s own token is forwarded to S1, and SQL uses the team employee ids as a parameter', async () => {
  await withApp(async (ctx) => {
    await get(ctx);
    const forwarded = ctx.upstream.calls.filter((c) => c.name === 'getTeamCompletedAssignments');
    assert.strictEqual(forwarded.length, 1);
    assert.strictEqual(forwarded[0].teamId, IDS.OPS);
    assert.strictEqual(forwarded[0].ctx.token.split('.').length, 3);
    const selects = ctx.pool.calls.filter((c) => /^\s*SELECT/i.test(c.sql));
    assert.strictEqual(selects.length, 2);
    assert.ok(selects.every((c) => c.sql.includes('ANY($1::uuid[])') && c.params[0].length === 3));
    assert.match(selects.find((c) => /compliance_flags/.test(c.sql)).sql, /resolved_at IS NULL/);
  });
});

test('200: the Service token (the daily jobs) may read any team', async () => {
  await withApp(async (ctx) => {
    ctx.upstream.assignments = [done(IDS.OMAR, T_FIRE)];
    const res = await get(ctx, IDS.LAB, tokens.service());
    assert.strictEqual(res.status, 200);
    assert.strictEqual(flagsOf(res.body, IDS.OMAR)[0].flagType, 'Missing');
  });
});

test('200 CONTRACT: the real Service 3 reader understands the answer (Missing, Expired, Expiring soon)', async () => {
  await withApp(async (ctx) => {
    ctx.upstream.assignments = [done(IDS.AHMED, T_FIRE), done(IDS.SARA, T_PRIVACY)];
    ctx.pool.selectRows = [
      cert('c1', IDS.SARA, T_PRIVACY, 'Verified', '2026-01-01'), // expired
      cert('c2', IDS.AHMED, T_SAFETY, 'Verified', '2026-12-02'), // expires in 9 days
    ];
    const res = await get(ctx);
    const s1Assignments = [
      { employeeId: IDS.AHMED, trainingId: T_FIRE, category: 'Safety' }, { employeeId: IDS.SARA, trainingId: T_PRIVACY, category: 'Privacy' },
      { employeeId: IDS.AHMED, trainingId: T_SAFETY, category: 'Safety' },
    ];
    const flags = flagsFromContract(res.body, s1Assignments, TODAY);
    const brief = flags.map((f) => [f.employeeId, f.type, f.expiryDate, f.status, f.category]).sort();
    assert.deepStrictEqual(brief, [
      [IDS.AHMED, 'ExpiringSoon', '2026-12-02', 'open', 'Safety'],
      [IDS.AHMED, 'Missing', null, 'open', 'Safety'],
      [IDS.SARA, 'Expired', '2026-01-01', 'open', 'Privacy'],
    ].sort());
  });
});

test('400 bad teamId / 401 no token / 403 Employee / 403 manager of another team / 404 unknown team', async () => {
  await withApp(async (ctx) => {
    assert.strictEqual((await get(ctx, 'nope')).status, 400);
    assert.strictEqual((await get(ctx, IDS.OPS, null)).status, 401);
    assert.strictEqual((await get(ctx, IDS.OPS, tokens.employee())).status, 403);
    assert.strictEqual((await get(ctx, IDS.OPS, tokens.omar())).status, 403);
    assert.strictEqual((await get(ctx, '10000000-0000-4000-8000-000000000099')).status, 404);
    assert.strictEqual(ctx.pool.calls.length, 0); // EN: no data was read for a refused caller / Franco: mafeesh data etqara le caller marfood
  });
});

test('503 S1 is down / 502 S1 fails on the assignments: an error body, never partial numbers', async () => {
  await withApp(async (ctx) => {
    ctx.upstream.teamsError = upstreamUnavailable('S1 is unavailable');
    assert.strictEqual((await get(ctx)).status, 503);
    ctx.upstream.teamsError = null;
    ctx.upstream.assignmentsError = upstreamError('S1 failed');
    const res = await get(ctx);
    assert.strictEqual(res.status, 502);
    assert.ok(!('employees' in res.body));
  });
});
