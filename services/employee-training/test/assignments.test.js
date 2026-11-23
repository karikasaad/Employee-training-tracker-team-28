// EN: API tests for branch kerolus/s1-assignments-overdue (contract 4.5, 4.9, 4.10): assign (one employee or
//     the whole team), my assignments, the team view with ?status=. Success, 400, 401, 403, 404, 409, and the
//     Overdue rule (calculated on read; due today is NOT overdue). Real app + real Postgres (seed).
// Franco: API tests le branch kerolus/s1-assignments-overdue: el assign (mowazzaf wa7ed aw el team kollo),
//     el assignments bta3ty, w view el team b ?status=. Success, 400, 401, 403, 404, 409, w rule el Overdue
//     (bet-et7seb wa2t el qeraya; ma3adha el naharda MESH overdue). App 7a2i2i + Postgres 7a2i2eya (el seed).
'use strict';
const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { IDS, skipDb, resetDatabase, closeDb, makeApp, call, tokens } = require('../test-support/helpers');
const { todayUtc } = require('../src/rules');

const T = {
  FIRE_SAFETY: '30000000-0000-4000-8000-000000000001',
  FIRST_AID: '30000000-0000-4000-8000-000000000002',
  CODE_OF_CONDUCT: '30000000-0000-4000-8000-000000000004',
  MANUAL_HANDLING: '30000000-0000-4000-8000-000000000008',
  UNKNOWN: '30000000-0000-4000-8000-000000000099',
};
const AHMED_FIRE_SAFETY = '40000000-0000-4000-8000-000000000001'; // seed: due 10 days ago, not completed

// EN: "YYYY-MM-DD" n days from today (UTC). / Franco: tareekh ba3d n ayam men el naharda (UTC).
function inDays(n) {
  return new Date(Date.parse(`${todayUtc()}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
}

describe('S1 assignments + Overdue', { skip: skipDb }, () => {
  let app;
  before(async () => { await resetDatabase(); app = makeApp(); });
  after(closeDb);

  // ------------------------------------------------------------ 4.10 GET /api/assignments/me (seed data)
  test('4.10 my assignments: Overdue is calculated (due 10 days ago), due TODAY stays Assigned', async () => {
    const res = await call(app, 'GET', '/api/assignments/me', { token: tokens.ahmed() });
    assert.equal(res.status, 200);
    const fire = res.body.find((a) => a.id === AHMED_FIRE_SAFETY);
    assert.equal(fire.status, 'Overdue');
    assert.equal(fire.daysOverdue, 10);
    const conduct = res.body.find((a) => a.trainingId === T.CODE_OF_CONDUCT);
    assert.equal(conduct.dueDate, todayUtc());
    assert.equal(conduct.status, 'Assigned');
    assert.equal(conduct.daysOverdue, 0);
    assert.ok(res.body.every((a) => a.employeeId === IDS.AHMED), 'only my own assignments');
  });

  test('4.10 my assignments: the Assignment JSON shape S2/S3 rely on', async () => {
    const res = await call(app, 'GET', '/api/assignments/me', { token: tokens.ahmed() });
    const a = res.body.find((x) => x.id === AHMED_FIRE_SAFETY);
    assert.deepEqual(Object.keys(a).sort(), ['assignedAt', 'assignedBy', 'category', 'completedAt', 'daysOverdue', 'dueDate',
      'employeeId', 'employeeName', 'id', 'renewalOfId', 'requiresCertificate', 'status', 'trainingId', 'trainingName'].sort());
    assert.equal(a.trainingName, 'Fire Safety');
    assert.equal(a.category, 'Safety');
    assert.equal(a.requiresCertificate, true);
    assert.equal(a.completedAt, null);
    assert.match(a.dueDate, /^\d{4}-\d{2}-\d{2}$/);
  });

  test('4.10 my assignments: completed LATE is still Completed; open ones come first', async () => {
    const res = await call(app, 'GET', '/api/assignments/me', { token: tokens.youssef() });
    assert.equal(res.status, 200);
    const firstCompleted = res.body.findIndex((a) => a.completedAt !== null);
    const lastOpen = res.body.map((a) => a.completedAt === null).lastIndexOf(true);
    assert.ok(firstCompleted === -1 || lastOpen < firstCompleted, 'open assignments are listed first');
    for (const a of res.body.filter((x) => x.completedAt)) assert.equal(a.status, 'Completed');
    // EN: seed: Youssef finished Forklift 10 days AFTER its due date -> still Completed, daysOverdue 0.
    // Franco: fel seed Youssef khallas el Forklift ba3d el ma3ad b 10 ayam -> bardo Completed w daysOverdue 0.
    const late = res.body.find((a) => a.trainingName === 'Forklift Operation' && a.completedAt);
    assert.ok(late.completedAt.slice(0, 10) > late.dueDate, 'completed after the due date');
    assert.equal(late.status, 'Completed');
    assert.equal(late.daysOverdue, 0);
  });

  test('4.10 my assignments: no token -> 401, Service token -> 403', async () => {
    assert.equal((await call(app, 'GET', '/api/assignments/me')).status, 401);
    assert.equal((await call(app, 'GET', '/api/assignments/me', { token: tokens.service() })).status, 403);
  });

  // ------------------------------------------------------------ 4.9 POST /api/assignments, one employee
  test('4.9 assign: manager -> own team member -> 201 Assignment (status Assigned, assignedBy = manager)', async () => {
    const res = await call(app, 'POST', '/api/assignments', {
      token: tokens.mona(), body: { employeeId: IDS.SARA, trainingId: T.FIRST_AID, dueDate: inDays(14) },
    });
    assert.equal(res.status, 201);
    assert.equal(res.body.employeeId, IDS.SARA);
    assert.equal(res.body.trainingName, 'First Aid');
    assert.equal(res.body.dueDate, inDays(14));
    assert.equal(res.body.status, 'Assigned');
    assert.equal(res.body.assignedBy, IDS.MONA);
    // EN: it shows up for Sara herself / Franco: beyezhar le Sara nafsaha
    const mine = await call(app, 'GET', '/api/assignments/me', { token: tokens.sara() });
    assert.ok(mine.body.some((a) => a.id === res.body.id));
  });

  test('4.9 assign: due date = today is allowed', async () => {
    const res = await call(app, 'POST', '/api/assignments', {
      token: tokens.mona(), body: { employeeId: IDS.YOUSSEF, trainingId: T.MANUAL_HANDLING, dueDate: todayUtc() },
    });
    assert.equal(res.status, 201);
    assert.equal(res.body.status, 'Assigned');
  });

  test('4.9 assign: a second OPEN assignment of the same training -> 409', async () => {
    const res = await call(app, 'POST', '/api/assignments', {
      token: tokens.mona(), body: { employeeId: IDS.AHMED, trainingId: T.FIRE_SAFETY, dueDate: inDays(30) },
    });
    assert.equal(res.status, 409);
    assert.equal(res.body.error.code, 'CONFLICT');
  });

  test('4.9 assign: invalid input -> 400 with the field name', async () => {
    const good = { employeeId: IDS.SARA, trainingId: T.CODE_OF_CONDUCT, dueDate: inDays(5) };
    const bad = [
      [{ ...good, dueDate: inDays(-1) }, 'dueDate'], // EN: yesterday / Franco: embare7
      [{ ...good, dueDate: '2026-02-30' }, 'dueDate'],
      [{ ...good, dueDate: '23/11/2026' }, 'dueDate'],
      [{ ...good, dueDate: undefined }, 'dueDate'],
      [{ ...good, trainingId: 'abc' }, 'trainingId'],
      [{ ...good, employeeId: 'abc' }, 'employeeId'],
      [{ ...good, teamId: IDS.OPS }, 'employeeId'], // EN: both given / Franco: el etnein
      [{ trainingId: T.CODE_OF_CONDUCT, dueDate: inDays(5) }, 'employeeId'], // EN: neither / Franco: wala wa7ed
    ];
    for (const [body, field] of bad) {
      const res = await call(app, 'POST', '/api/assignments', { token: tokens.mona(), body });
      assert.equal(res.status, 400, JSON.stringify(body));
      assert.equal(res.body.error.details[0].field, field, JSON.stringify(body));
    }
  });

  test('4.9 assign: employee -> 403, no token -> 401', async () => {
    const body = { employeeId: IDS.SARA, trainingId: T.CODE_OF_CONDUCT, dueDate: inDays(5) };
    assert.equal((await call(app, 'POST', '/api/assignments', { token: tokens.ahmed(), body })).status, 403);
    assert.equal((await call(app, 'POST', '/api/assignments', { body })).status, 401);
  });

  test('4.9 assign: manager -> employee of ANOTHER team -> 403 (nothing created)', async () => {
    const body = { employeeId: IDS.NOUR, trainingId: T.CODE_OF_CONDUCT, dueDate: inDays(5) };
    const res = await call(app, 'POST', '/api/assignments', { token: tokens.mona(), body });
    assert.equal(res.status, 403);
    const nour = await call(app, 'GET', '/api/assignments/me', { token: tokens.nour() });
    assert.ok(!nour.body.some((a) => a.trainingId === T.CODE_OF_CONDUCT));
  });

  test('4.9 assign: unknown employee / training / team -> 404', async () => {
    const d = inDays(5);
    assert.equal((await call(app, 'POST', '/api/assignments', { token: tokens.mona(), body: { employeeId: IDS.UNKNOWN_EMPLOYEE, trainingId: T.CODE_OF_CONDUCT, dueDate: d } })).status, 404);
    assert.equal((await call(app, 'POST', '/api/assignments', { token: tokens.mona(), body: { employeeId: IDS.SARA, trainingId: T.UNKNOWN, dueDate: d } })).status, 404);
    assert.equal((await call(app, 'POST', '/api/assignments', { token: tokens.mona(), body: { teamId: IDS.UNKNOWN_TEAM, trainingId: T.CODE_OF_CONDUCT, dueDate: d } })).status, 404);
  });

  // ------------------------------------------------------------ 4.9 POST /api/assignments, whole team
  test('4.9 assign to team: members who already have it OPEN are skipped, the rest get it', async () => {
    // EN: seed: Ahmed already has Code of Conduct open (due today) -> skipped.
    // Franco: fel seed Ahmed 3ando Code of Conduct maftoo7 (ma3ado el naharda) -> skipped.
    const res = await call(app, 'POST', '/api/assignments', {
      token: tokens.mona(), body: { teamId: IDS.OPS, trainingId: T.CODE_OF_CONDUCT, dueDate: inDays(21) },
    });
    assert.equal(res.status, 201);
    assert.deepEqual(res.body.skipped, [{ employeeId: IDS.AHMED, reason: 'OPEN_ASSIGNMENT_EXISTS' }]);
    assert.deepEqual(res.body.created.map((a) => a.employeeId).sort(), [IDS.MONA, IDS.SARA, IDS.YOUSSEF].sort());
    assert.ok(res.body.created.every((a) => a.trainingId === T.CODE_OF_CONDUCT && a.status === 'Assigned'));
  });

  test('4.9 assign to team: the manager of ANOTHER team -> 403', async () => {
    const res = await call(app, 'POST', '/api/assignments', {
      token: tokens.omar(), body: { teamId: IDS.OPS, trainingId: T.MANUAL_HANDLING, dueDate: inDays(7) },
    });
    assert.equal(res.status, 403);
  });

  // ------------------------------------------------------------ 4.5 GET /api/teams/{teamId}/assignments
  test('4.5 team view: manager of the team -> 200, every row has employeeName and a calculated status', async () => {
    const res = await call(app, 'GET', `/api/teams/${IDS.OPS}/assignments`, { token: tokens.mona() });
    assert.equal(res.status, 200);
    assert.ok(res.body.length > 0);
    assert.ok(res.body.every((a) => a.employeeName && ['Assigned', 'Completed', 'Overdue'].includes(a.status)));
    const ids = new Set([IDS.MONA, IDS.AHMED, IDS.SARA, IDS.YOUSSEF]);
    assert.ok(res.body.every((a) => ids.has(a.employeeId)), 'only Operations employees');
  });

  test('4.5 team view: ?status=overdue / completed / assigned filter on the calculated status', async () => {
    for (const [query, status] of [['overdue', 'Overdue'], ['COMPLETED', 'Completed'], ['assigned', 'Assigned']]) {
      const res = await call(app, 'GET', `/api/teams/${IDS.OPS}/assignments?status=${query}`, { token: tokens.mona() });
      assert.equal(res.status, 200);
      assert.ok(res.body.length > 0, query);
      assert.ok(res.body.every((a) => a.status === status), query);
    }
    const overdue = await call(app, 'GET', `/api/teams/${IDS.OPS}/assignments?status=overdue`, { token: tokens.mona() });
    assert.ok(overdue.body.some((a) => a.id === AHMED_FIRE_SAFETY));
    assert.ok(!overdue.body.some((a) => a.dueDate === todayUtc()), 'due today is never in the overdue list');
  });

  test('4.5 team view: Service token -> 200 (S3 daily snapshot)', async () => {
    const res = await call(app, 'GET', `/api/teams/${IDS.LAB}/assignments`, { token: tokens.service() });
    assert.equal(res.status, 200);
    assert.ok(res.body.length > 0);
  });

  test('4.5 team view: bad ?status -> 400, other manager -> 403, employee -> 403, unknown -> 404, malformed -> 400, no token -> 401', async () => {
    assert.equal((await call(app, 'GET', `/api/teams/${IDS.OPS}/assignments?status=late`, { token: tokens.mona() })).status, 400);
    assert.equal((await call(app, 'GET', `/api/teams/${IDS.OPS}/assignments`, { token: tokens.omar() })).status, 403);
    assert.equal((await call(app, 'GET', `/api/teams/${IDS.OPS}/assignments`, { token: tokens.ahmed() })).status, 403);
    assert.equal((await call(app, 'GET', `/api/teams/${IDS.UNKNOWN_TEAM}/assignments`, { token: tokens.mona() })).status, 404);
    assert.equal((await call(app, 'GET', '/api/teams/xyz/assignments', { token: tokens.mona() })).status, 400);
    assert.equal((await call(app, 'GET', `/api/teams/${IDS.OPS}/assignments`)).status, 401);
  });
});
