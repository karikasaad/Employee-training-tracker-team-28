// EN: API tests for branch kerolus/s1-lookup-teams (contract 4.1-4.4): success, 400, 401, 403 (employee;
//     manager of another team), 404. Real app + real Postgres (seed) + real auth module.
// Franco: API tests le branch kerolus/s1-lookup-teams (el contract 4.1-4.4): success, 400, 401, 403
//     (employee; manager team tany), 404. App 7a2i2i + Postgres 7a2i2eya (el seed) + auth module 7a2i2i.
'use strict';
const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { IDS, skipDb, resetDatabase, closeDb, getAppDb, makeApp, call, tokens } = require('../test-support/helpers');

describe('S1 lookup + teams', { skip: skipDb }, () => {
  let app;
  before(async () => { await resetDatabase(); app = makeApp(); });
  after(closeDb);

  // ------------------------------------------------------------ least privilege
  test('the app talks to the database as svc_s1, never the admin user', async () => {
    const row = await getAppDb().queryOne('SELECT current_user AS u', []);
    assert.equal(row.u, 'svc_s1');
  });

  // ------------------------------------------------------------ 4.1 GET /api/employees/me
  test('4.1 me: employee gets their own profile (Employee shape, role Employee)', async () => {
    const res = await call(app, 'GET', '/api/employees/me', { token: tokens.ahmed() });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, {
      id: IDS.AHMED, name: 'Ahmed Ali', email: 'ahmed@example.com', teamId: IDS.OPS,
      teamName: 'Operations', managerId: IDS.MONA, role: 'Employee',
    });
  });

  test('4.1 me: a manager gets role Manager', async () => {
    const res = await call(app, 'GET', '/api/employees/me', { token: tokens.mona() });
    assert.equal(res.status, 200);
    assert.equal(res.body.id, IDS.MONA);
    assert.equal(res.body.role, 'Manager');
  });

  test('4.1 me: no token -> 401, expired token -> 401', async () => {
    assert.equal((await call(app, 'GET', '/api/employees/me')).status, 401);
    const expired = await call(app, 'GET', '/api/employees/me', { token: tokens.expired() });
    assert.equal(expired.status, 401);
    assert.equal(expired.body.error.code, 'UNAUTHENTICATED');
  });

  test('4.1 me: valid token but no employee profile -> 404', async () => {
    const res = await call(app, 'GET', '/api/employees/me', { token: tokens.stranger() });
    assert.equal(res.status, 404);
  });

  test('4.1 me: Service token is not a person -> 403', async () => {
    assert.equal((await call(app, 'GET', '/api/employees/me', { token: tokens.service() })).status, 403);
  });

  // ------------------------------------------------------------ 4.2 GET /api/employees/{id}
  test('4.2 employee by id: self -> 200', async () => {
    const res = await call(app, 'GET', `/api/employees/${IDS.AHMED}`, { token: tokens.ahmed() });
    assert.equal(res.status, 200);
    assert.equal(res.body.id, IDS.AHMED);
  });

  test('4.2 employee by id: manager of their team -> 200', async () => {
    const res = await call(app, 'GET', `/api/employees/${IDS.SARA}`, { token: tokens.mona() });
    assert.equal(res.status, 200);
    assert.equal(res.body.teamId, IDS.OPS);
  });

  test('4.2 employee by id: Service token -> 200 (lookup used by S2/S3 jobs)', async () => {
    assert.equal((await call(app, 'GET', `/api/employees/${IDS.NOUR}`, { token: tokens.service() })).status, 200);
  });

  test('4.2 employee by id: another employee (IDOR attempt) -> 403', async () => {
    const res = await call(app, 'GET', `/api/employees/${IDS.SARA}`, { token: tokens.ahmed() });
    assert.equal(res.status, 403);
    assert.equal(res.body.error.code, 'FORBIDDEN');
  });

  test('4.2 employee by id: manager of ANOTHER team -> 403', async () => {
    assert.equal((await call(app, 'GET', `/api/employees/${IDS.NOUR}`, { token: tokens.mona() })).status, 403);
  });

  test('4.2 employee by id: malformed id -> 400, unknown id -> 404, no token -> 401', async () => {
    const bad = await call(app, 'GET', '/api/employees/not-a-uuid', { token: tokens.mona() });
    assert.equal(bad.status, 400);
    assert.equal(bad.body.error.details[0].field, 'id');
    assert.equal((await call(app, 'GET', `/api/employees/${IDS.UNKNOWN_EMPLOYEE}`, { token: tokens.mona() })).status, 404);
    assert.equal((await call(app, 'GET', `/api/employees/${IDS.AHMED}`)).status, 401);
  });

  test('4.2 employee by id: SQL-injection text in the id -> 400, never a 500', async () => {
    const res = await call(app, 'GET', `/api/employees/${encodeURIComponent("x' OR '1'='1")}`, { token: tokens.mona() });
    assert.equal(res.status, 400);
  });

  // ------------------------------------------------------------ 4.3 GET /api/teams
  test('4.3 teams: a manager sees ONLY their own team', async () => {
    const res = await call(app, 'GET', '/api/teams', { token: tokens.mona() });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, [{ id: IDS.OPS, name: 'Operations', managerId: IDS.MONA, managerName: 'Mona Hassan', employeeCount: 4 }]);
    const omar = await call(app, 'GET', '/api/teams', { token: tokens.omar() });
    assert.deepEqual(omar.body.map((t) => t.id), [IDS.LAB]);
  });

  test('4.3 teams: Service token sees every team', async () => {
    const res = await call(app, 'GET', '/api/teams', { token: tokens.service() });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.map((t) => t.name), ['Laboratory', 'Operations']);
  });

  test('4.3 teams: employee -> 403, no token -> 401', async () => {
    assert.equal((await call(app, 'GET', '/api/teams', { token: tokens.ahmed() })).status, 403);
    assert.equal((await call(app, 'GET', '/api/teams')).status, 401);
  });

  // ------------------------------------------------------------ 4.4 GET /api/teams/{teamId}/employees
  test('4.4 team employees: manager of the team -> 200, ordered by name', async () => {
    const res = await call(app, 'GET', `/api/teams/${IDS.OPS}/employees`, { token: tokens.mona() });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.map((e) => e.name), ['Ahmed Ali', 'Mona Hassan', 'Sara Mahmoud', 'Youssef Adel']);
    assert.ok(res.body.every((e) => e.teamId === IDS.OPS));
  });

  test('4.4 team employees: Service token -> 200', async () => {
    const res = await call(app, 'GET', `/api/teams/${IDS.LAB}/employees`, { token: tokens.service() });
    assert.equal(res.status, 200);
    assert.equal(res.body.length, 4);
  });

  test('4.4 team employees: manager of ANOTHER team -> 403 (what S3 relies on)', async () => {
    const res = await call(app, 'GET', `/api/teams/${IDS.LAB}/employees`, { token: tokens.mona() });
    assert.equal(res.status, 403);
  });

  test('4.4 team employees: employee -> 403, even for their own team', async () => {
    assert.equal((await call(app, 'GET', `/api/teams/${IDS.OPS}/employees`, { token: tokens.ahmed() })).status, 403);
  });

  test('4.4 team employees: unknown team -> 404, malformed -> 400, no token -> 401', async () => {
    assert.equal((await call(app, 'GET', `/api/teams/${IDS.UNKNOWN_TEAM}/employees`, { token: tokens.mona() })).status, 404);
    assert.equal((await call(app, 'GET', '/api/teams/abc/employees', { token: tokens.mona() })).status, 400);
    assert.equal((await call(app, 'GET', `/api/teams/${IDS.OPS}/employees`)).status, 401);
  });

  // ------------------------------------------------------------ general
  test('unknown route -> 404 JSON, and every response carries X-Request-Id', async () => {
    const res = await call(app, 'GET', '/api/nope', { token: tokens.mona() });
    assert.equal(res.status, 404);
    assert.equal(res.body.error.code, 'NOT_FOUND');
    assert.ok(res.headers['x-request-id']);
  });
});
