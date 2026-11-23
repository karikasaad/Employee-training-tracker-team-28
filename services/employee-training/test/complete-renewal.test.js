// EN: API tests for branch kerolus/s1-complete-renewal (contract 4.11): the employee completes their OWN
//     assignment; the renewal rule creates the next one for trainings that expire. Success, 400, 401, 403
//     (another employee; the manager), 404, 409 (already completed, also when two requests race).
// Franco: API tests le branch kerolus/s1-complete-renewal (el contract 4.11): el mowazzaf be2fel el
//     assignment BTA3O; rule el renewal beta3mel el gai lel trainings elly leha sala7eya. Success, 400, 401,
//     403 (mowazzaf tany; el manager), 404, 409 (khelset 2abl kda, w kaman lama etnein requests yetsaba2o).
'use strict';
const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { IDS, skipDb, resetDatabase, closeDb, makeApp, call, tokens } = require('../test-support/helpers');
const { todayUtc, nextDueDate } = require('../src/rules');

const A = {
  AHMED_FIRE_SAFETY: '40000000-0000-4000-8000-000000000001', // open, Overdue, Fire Safety = 12 months
  AHMED_CODE_OF_CONDUCT: '40000000-0000-4000-8000-000000000002', // open, due today, never expires
  SARA_DATA_PROTECTION: '40000000-0000-4000-8000-000000000005', // open, future, 12 months
  SARA_FIRE_COMPLETED: '40000000-0000-4000-8000-000000000003', // already completed (seed)
  HANA_CHEMICAL: '40000000-0000-4000-8000-000000000012', // open, Hana (Laboratory)
  UNKNOWN: '40000000-0000-4000-8000-000000000099',
};
const FIRE_SAFETY = '30000000-0000-4000-8000-000000000001';

const complete = (app, id, token) => call(app, 'PATCH', `/api/assignments/${id}/complete`, { token });

describe('S1 complete + renewal', { skip: skipDb }, () => {
  let app;
  before(async () => { await resetDatabase(); app = makeApp(); });
  after(closeDb);

  test('4.11 complete: own Overdue assignment -> 200 Completed + renewal due completedAt + 12 months', async () => {
    const res = await complete(app, A.AHMED_FIRE_SAFETY, tokens.ahmed());
    assert.equal(res.status, 200);
    const { completed, renewal } = res.body;
    assert.equal(completed.id, A.AHMED_FIRE_SAFETY);
    assert.equal(completed.status, 'Completed'); // EN: completed late is still Completed
    assert.equal(completed.daysOverdue, 0);
    assert.equal(completed.completedAt.slice(0, 10), todayUtc());
    // EN: the renewal: same employee + training, due completedAt + validityMonths, linked to the old one.
    // Franco: el renewal: nafs el mowazzaf w el training, ma3ado completedAt + validityMonths, marboot bel adeem.
    assert.equal(renewal.employeeId, IDS.AHMED);
    assert.equal(renewal.trainingId, FIRE_SAFETY);
    assert.equal(renewal.renewalOfId, A.AHMED_FIRE_SAFETY);
    assert.equal(renewal.dueDate, nextDueDate(completed.completedAt, 12));
    assert.equal(renewal.status, 'Assigned');
    assert.equal(renewal.completedAt, null);
    assert.equal(renewal.assignedBy, IDS.MONA); // EN: same manager as the original / Franco: nafs el manager
  });

  test('4.11 complete: it really changed: my list shows it Completed + the new open renewal; no longer Overdue for the team', async () => {
    const mine = await call(app, 'GET', '/api/assignments/me', { token: tokens.ahmed() });
    const fire = mine.body.filter((a) => a.trainingId === FIRE_SAFETY);
    assert.deepEqual(fire.map((a) => a.status).sort(), ['Assigned', 'Completed']);
    const overdue = await call(app, 'GET', `/api/teams/${IDS.OPS}/assignments?status=overdue`, { token: tokens.mona() });
    assert.ok(!overdue.body.some((a) => a.id === A.AHMED_FIRE_SAFETY));
  });

  test('4.11 complete: the renewal is the ONE open assignment, so assigning the same training again -> 409', async () => {
    const res = await call(app, 'POST', '/api/assignments', {
      token: tokens.mona(), body: { employeeId: IDS.AHMED, trainingId: FIRE_SAFETY, dueDate: todayUtc() },
    });
    assert.equal(res.status, 409);
  });

  test('4.11 complete: a training that never expires -> renewal is null', async () => {
    const res = await complete(app, A.AHMED_CODE_OF_CONDUCT, tokens.ahmed());
    assert.equal(res.status, 200);
    assert.equal(res.body.completed.status, 'Completed');
    assert.equal(res.body.renewal, null);
  });

  test('4.11 complete: the same assignment again -> 409 (seed: already completed -> 409 too)', async () => {
    const again = await complete(app, A.AHMED_FIRE_SAFETY, tokens.ahmed());
    assert.equal(again.status, 409);
    assert.equal(again.body.error.code, 'CONFLICT');
    assert.equal((await complete(app, A.SARA_FIRE_COMPLETED, tokens.sara())).status, 409);
  });

  test('4.11 complete: another employee -> 403 and nothing changes (IDOR attempt)', async () => {
    const res = await complete(app, A.SARA_DATA_PROTECTION, tokens.ahmed());
    assert.equal(res.status, 403);
    const sara = await call(app, 'GET', '/api/assignments/me', { token: tokens.sara() });
    assert.equal(sara.body.find((a) => a.id === A.SARA_DATA_PROTECTION).completedAt, null);
  });

  test('4.11 complete: even the employee\'s own manager -> 403 (only the employee completes)', async () => {
    assert.equal((await complete(app, A.SARA_DATA_PROTECTION, tokens.mona())).status, 403);
    assert.equal((await complete(app, A.HANA_CHEMICAL, tokens.omar())).status, 403);
  });

  test('4.11 complete: unknown -> 404, malformed -> 400, no token -> 401, Service token -> 403', async () => {
    assert.equal((await complete(app, A.UNKNOWN, tokens.ahmed())).status, 404);
    assert.equal((await complete(app, 'not-a-uuid', tokens.ahmed())).status, 400);
    assert.equal((await complete(app, A.SARA_DATA_PROTECTION)).status, 401);
    assert.equal((await complete(app, A.SARA_DATA_PROTECTION, tokens.service())).status, 403);
  });

  test('4.11 complete: an employee id in the body is ignored (identity comes from the token only)', async () => {
    const res = await call(app, 'PATCH', `/api/assignments/${A.SARA_DATA_PROTECTION}/complete`, {
      token: tokens.ahmed(), body: { employeeId: IDS.SARA },
    });
    assert.equal(res.status, 403);
  });

  test('4.11 complete: two requests at the same moment -> exactly one 200 and one 409, one renewal', async () => {
    const [r1, r2] = await Promise.all([
      complete(app, A.SARA_DATA_PROTECTION, tokens.sara()),
      complete(app, A.SARA_DATA_PROTECTION, tokens.sara()),
    ]);
    assert.deepEqual([r1.status, r2.status].sort(), [200, 409]);
    const mine = await call(app, 'GET', '/api/assignments/me', { token: tokens.sara() });
    const renewals = mine.body.filter((a) => a.renewalOfId === A.SARA_DATA_PROTECTION);
    assert.equal(renewals.length, 1);
  });
});
