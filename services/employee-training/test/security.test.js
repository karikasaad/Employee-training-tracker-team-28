// EN: Service 1 SECURITY test suite (to-do 3.2): controlled attacks, each with an ID, the scenario, the expected
//     result and the ACTUAL result recorded from the real run. Real app + real Postgres (seed) + real auth module.
//     `npm run test:security` runs only this file and writes docs/evidence/s1/security_results.md from the run;
//     nothing in that table is typed by hand.
// Franco: Security tests bta3et Service 1: hogoom mowagaha, kol wa7ed leh ID w el scenario w el natiga el
//     motawaqqa3a w el natiga el FE3LEYA men el tashgheel el 7a2i2i. `npm run test:security` beyshaghal el file
//     da bas w yekteb docs/evidence/s1/security_results.md men el tashgheel; mafeesh 7aga fel gadwal maktooba b-eedena.
'use strict';
const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const { IDS, skipDb, resetDatabase, closeDb, getAppDb, makeApp, call, token, tokens } = require('../test-support/helpers');
const { createLogger } = require('../../common/logging');
const { todayUtc } = require('../src/rules');

const SARA_DATA_PROTECTION = '40000000-0000-4000-8000-000000000005';
const CODE_OF_CONDUCT = '30000000-0000-4000-8000-000000000004';

// EN: every test records what really happened; the report script turns this into the evidence table.
// Franco: kol test beysaggel eh elly 7asal fe3lan; script el report bey7awwelha le gadwal el evidence.
const results = [];
function record(id, scenario, expected, actual, pass) {
  results.push({ id, scenario, expected, actual, pass });
  assert.ok(pass, `${id}: expected ${expected}, got ${actual}`);
}
const httpActual = (res) => `${res.status}${res.body && res.body.error ? ` ${res.body.error.code}` : ''}`;

// EN: attacker tokens. forged = signed with the attacker's OWN key but claiming our key id;
//     tampered = a real Employee token whose payload was edited to say "Manager"; none = no signature at all.
// Franco: tokens el attacker. forged = mamdy b key el attacker bas bey2ool enno kid bta3na; tampered = token
//     Employee 7a2i2i el payload bta3o et3addel le "Manager"; none = men gheir emda2 khales.
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
function forgedToken() {
  const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const now = Math.floor(Date.now() / 1000);
  const head = `${b64({ alg: 'RS256', kid: 'test-key' })}.${b64({ iss: 'https://cognito.test/pool', token_use: 'access', client_id: 'web-client', sub: 'sub-mona.manager', iat: now, exp: now + 900, 'cognito:groups': ['Manager'] })}`;
  return `${head}.${crypto.sign('RSA-SHA256', Buffer.from(head), privateKey).toString('base64url')}`;
}
function tamperedToken() {
  const [h, p, s] = tokens.ahmed().split('.');
  const payload = JSON.parse(Buffer.from(p, 'base64url').toString());
  payload['cognito:groups'] = ['Manager'];
  return `${h}.${b64(payload)}.${s}`;
}
function unsignedToken() {
  const [, p] = tokens.mona().split('.');
  return `${b64({ alg: 'none', kid: 'test-key' })}.${p}.`;
}

describe('S1 security tests', { skip: skipDb }, () => {
  let app;
  const logLines = [];
  before(async () => {
    await resetDatabase();
    app = makeApp({ logger: createLogger('employee-training', { write: (line) => logLines.push(line) }) });
  });
  after(async () => {
    await closeDb();
    if (process.env.S1_SECURITY_RESULTS) fs.writeFileSync(process.env.S1_SECURITY_RESULTS, JSON.stringify(results, null, 2));
  });

  // ------------------------------------------------------------ identity: the token
  test('S1-SEC-01 no token', async () => {
    const res = await call(app, 'GET', '/api/assignments/me');
    record('S1-SEC-01', 'GET /api/assignments/me with no Authorization header', '401', httpActual(res), res.status === 401);
  });
  test('S1-SEC-02 expired token', async () => {
    const res = await call(app, 'GET', '/api/assignments/me', { token: tokens.expired() });
    record('S1-SEC-02', 'Expired access token (exp in the past)', '401', httpActual(res), res.status === 401);
  });
  test('S1-SEC-03 forged token', async () => {
    const res = await call(app, 'GET', `/api/teams/${IDS.OPS}/employees`, { token: forgedToken() });
    record('S1-SEC-03', 'Token signed with an attacker key, claiming a Manager and our key id', '401', httpActual(res), res.status === 401);
  });
  test('S1-SEC-04 tampered token', async () => {
    const res = await call(app, 'POST', '/api/trainings', { token: tamperedToken(), body: { name: 'Hacked', category: 'X' } });
    record('S1-SEC-04', 'Employee token edited to group "Manager" (signature no longer matches)', '401', httpActual(res), res.status === 401);
  });
  test('S1-SEC-05 unsigned token (alg none)', async () => {
    const res = await call(app, 'GET', '/api/assignments/me', { token: unsignedToken() });
    record('S1-SEC-05', 'Token with alg "none" and no signature', '401', httpActual(res), res.status === 401);
  });
  test('S1-SEC-06 ID token instead of access token', async () => {
    const res = await call(app, 'GET', '/api/assignments/me', { token: token({ as: 'ahmed', tokenUse: 'id' }) });
    record('S1-SEC-06', 'Valid signature but token_use "id" (ID token sent to the API)', '401', httpActual(res), res.status === 401);
  });

  // ------------------------------------------------------------ authorization: the role
  test('S1-SEC-07 employee assigns a training', async () => {
    const res = await call(app, 'POST', '/api/assignments', { token: tokens.ahmed(), body: { employeeId: IDS.SARA, trainingId: CODE_OF_CONDUCT, dueDate: todayUtc() } });
    record('S1-SEC-07', 'Employee calls POST /api/assignments (Manager only)', '403', httpActual(res), res.status === 403);
  });
  test('S1-SEC-08 employee creates a training', async () => {
    const res = await call(app, 'POST', '/api/trainings', { token: tokens.ahmed(), body: { name: 'Employee made', category: 'X' } });
    record('S1-SEC-08', 'Employee calls POST /api/trainings (Manager only)', '403', httpActual(res), res.status === 403);
  });
  test('S1-SEC-09 service token on a person route', async () => {
    const res = await call(app, 'GET', '/api/assignments/me', { token: tokens.service() });
    record('S1-SEC-09', 'Service (job) token calls a person-only route', '403', httpActual(res), res.status === 403);
  });

  // ------------------------------------------------------------ ownership: the team and the record
  test('S1-SEC-10 manager assigns outside their team', async () => {
    const res = await call(app, 'POST', '/api/assignments', { token: tokens.mona(), body: { employeeId: IDS.NOUR, trainingId: CODE_OF_CONDUCT, dueDate: todayUtc() } });
    record('S1-SEC-10', 'Manager of Operations assigns to a Laboratory employee', '403', httpActual(res), res.status === 403);
  });
  test('S1-SEC-11 manager reads another team', async () => {
    const res = await call(app, 'GET', `/api/teams/${IDS.LAB}/assignments`, { token: tokens.mona() });
    record('S1-SEC-11', 'Manager of Operations reads the Laboratory team assignments', '403', httpActual(res), res.status === 403);
  });
  test('S1-SEC-12 employee reads another employee (IDOR)', async () => {
    const res = await call(app, 'GET', `/api/employees/${IDS.SARA}`, { token: tokens.ahmed() });
    record('S1-SEC-12', 'Employee changes the id in GET /api/employees/{id} to a colleague', '403', httpActual(res), res.status === 403);
  });
  test('S1-SEC-13 employee completes another employee\'s assignment (IDOR)', async () => {
    const res = await call(app, 'PATCH', `/api/assignments/${SARA_DATA_PROTECTION}/complete`, { token: tokens.ahmed() });
    const sara = await call(app, 'GET', '/api/assignments/me', { token: tokens.sara() });
    const untouched = sara.body.find((a) => a.id === SARA_DATA_PROTECTION).completedAt === null;
    record('S1-SEC-13', 'Employee completes a colleague\'s assignment; the record must stay unchanged', '403, record unchanged',
      `${httpActual(res)}, record ${untouched ? 'unchanged' : 'CHANGED'}`, res.status === 403 && untouched);
  });
  test('S1-SEC-14 identity from the body is ignored', async () => {
    const res = await call(app, 'PATCH', `/api/assignments/${SARA_DATA_PROTECTION}/complete`, { token: tokens.ahmed(), body: { employeeId: IDS.SARA } });
    record('S1-SEC-14', 'Same as 13 but sends employeeId of the colleague in the body', '403', httpActual(res), res.status === 403);
  });
  test('S1-SEC-15 manager completes for a team member', async () => {
    const res = await call(app, 'PATCH', `/api/assignments/${SARA_DATA_PROTECTION}/complete`, { token: tokens.mona() });
    record('S1-SEC-15', 'Manager tries to mark a team member\'s training completed (only the employee may)', '403', httpActual(res), res.status === 403);
  });

  // ------------------------------------------------------------ input validation and injection
  test('S1-SEC-16 SQL injection in a query parameter', async () => {
    const res = await call(app, 'GET', `/api/trainings?category=${encodeURIComponent("Safety' OR '1'='1")}`, { token: tokens.mona() });
    const ok = res.status === 200 && Array.isArray(res.body) && res.body.length === 0;
    record('S1-SEC-16', "?category=Safety' OR '1'='1 (classic injection)", '200 with an empty list, no 500', `${res.status}, ${Array.isArray(res.body) ? res.body.length : '?'} rows`, ok);
  });
  test('S1-SEC-17 SQL injection in a path id', async () => {
    const res = await call(app, 'GET', `/api/employees/${encodeURIComponent("1; DROP TABLE employees; --")}`, { token: tokens.mona() });
    const still = await getAppDb().queryOne('SELECT count(*)::int AS n FROM employees', []);
    record('S1-SEC-17', 'Path id "1; DROP TABLE employees; --"', '400, table still there', `${httpActual(res)}, employees rows = ${still.n}`, res.status === 400 && still.n === 8);
  });
  test('S1-SEC-18 invalid input: due date in the past', async () => {
    const res = await call(app, 'POST', '/api/assignments', { token: tokens.mona(), body: { employeeId: IDS.SARA, trainingId: CODE_OF_CONDUCT, dueDate: '2020-01-01' } });
    record('S1-SEC-18', 'Manager assigns with dueDate 2020-01-01', '400 VALIDATION_ERROR', httpActual(res), res.status === 400);
  });
  test('S1-SEC-19 oversized request body', async () => {
    const res = await call(app, 'POST', '/api/trainings', { token: tokens.mona(), body: { name: 'x', category: 'y', pad: 'z'.repeat(200 * 1024) } });
    record('S1-SEC-19', 'JSON body of about 200 KB (limit 100 KB)', '413', httpActual(res), res.status === 413);
  });

  // ------------------------------------------------------------ least privilege and logging
  test('S1-SEC-20 database least privilege', async () => {
    let denied = false;
    try { await getAppDb().query('SELECT count(*) FROM certificates', []); } catch (err) { denied = /permission denied/.test(err.message); }
    const who = await getAppDb().queryOne('SELECT current_user AS u', []);
    record('S1-SEC-20', 'S1 database login reads an S2 table (certificates)', 'role svc_s1, permission denied',
      `role ${who.u}, ${denied ? 'permission denied' : 'ALLOWED'}`, who.u === 'svc_s1' && denied);
  });
  test('S1-SEC-21 security events logged without secrets', async () => {
    const lines = logLines.map((l) => JSON.parse(l));
    const authFailures = lines.filter((l) => l.event === 'auth_failure' && l.level === 'warn').length;
    const forbidden = lines.filter((l) => l.event === 'forbidden' && l.level === 'warn').length;
    const leaked = logLines.some((l) => /eyJ[A-Za-z0-9_-]{10,}\./.test(l) || /authorization/i.test(l) && !/\[REDACTED\]/.test(l));
    record('S1-SEC-21', 'The 401/403 attempts above appear in the JSON logs (warn) with no token or Authorization header',
      'auth_failure and forbidden logged, no token in logs', `${authFailures} auth_failure, ${forbidden} forbidden, token in logs: ${leaked ? 'YES' : 'no'}`,
      authFailures >= 6 && forbidden >= 6 && !leaked);
  });
});
