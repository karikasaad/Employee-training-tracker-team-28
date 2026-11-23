// EN: Tests for branch kerolus/s1-team-views (contract 4.5b): the pure summarizeTeam() function and the
//     GET /api/teams/{teamId}/summary endpoint. The expected numbers for the seed are worked out by hand in
//     the comments, so they can be checked in the discussion.
// Franco: Tests le branch kerolus/s1-team-views (el contract 4.5b): el function summarizeTeam() w el endpoint.
//     El ar2am el motawaqqa3a lel seed ma7soba b-eedena fel comments 3ashan netla2 menha fel discussion.
'use strict';
const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { summarizeTeam } = require('../src/summary');
const { IDS, skipDb, resetDatabase, closeDb, makeApp, call, tokens } = require('../test-support/helpers');
const { todayUtc } = require('../src/rules');

// ------------------------------------------------------------ pure function
test('summarizeTeam: counts per status, max days overdue, next due date, zeros for members with nothing', () => {
  const employees = [{ id: 'e1', name: 'Zed', role: 'Employee' }, { id: 'e2', name: 'Amy', role: 'Employee' }, { id: 'm', name: 'Boss', role: 'Manager' }];
  const a = (employeeId, status, dueDate, daysOverdue = 0) => ({ employeeId, status, dueDate, daysOverdue });
  const out = summarizeTeam(employees, [
    a('e1', 'Overdue', '2026-11-01', 22), a('e1', 'Overdue', '2026-11-20', 3), a('e1', 'Assigned', '2026-12-10'),
    a('e2', 'Assigned', '2026-12-31'), a('e2', 'Assigned', '2026-12-05'), a('e2', 'Completed', '2026-10-01'),
    a('stranger', 'Overdue', '2026-01-01', 300), // EN: not a member -> ignored / Franco: mesh 3odw -> metgahel
  ]);
  assert.deepEqual(out.employees, [
    { employeeId: 'e1', name: 'Zed', role: 'Employee', assigned: 1, overdue: 2, completed: 0, maxDaysOverdue: 22, nextDueDate: '2026-12-10' },
    { employeeId: 'e2', name: 'Amy', role: 'Employee', assigned: 2, overdue: 0, completed: 1, maxDaysOverdue: 0, nextDueDate: '2026-12-05' },
    { employeeId: 'm', name: 'Boss', role: 'Manager', assigned: 0, overdue: 0, completed: 0, maxDaysOverdue: 0, nextDueDate: null },
  ]);
  assert.deepEqual(out.totals, { employees: 3, assigned: 3, overdue: 2, completed: 1, employeesWithOverdue: 1 });
});

test('summarizeTeam: ties are ordered by longest overdue, then by name; empty team -> zeros', () => {
  const employees = [{ id: 'a', name: 'Bob' }, { id: 'b', name: 'Ann' }, { id: 'c', name: 'Cat' }];
  const out = summarizeTeam(employees, [
    { employeeId: 'a', status: 'Overdue', dueDate: '2026-11-20', daysOverdue: 3 },
    { employeeId: 'c', status: 'Overdue', dueDate: '2026-11-01', daysOverdue: 22 },
  ]);
  assert.deepEqual(out.employees.map((r) => r.name), ['Cat', 'Bob', 'Ann']);
  assert.deepEqual(summarizeTeam([], []), { totals: { employees: 0, assigned: 0, overdue: 0, completed: 0, employeesWithOverdue: 0 }, employees: [] });
});

// ------------------------------------------------------------ API
describe('S1 team summary API', { skip: skipDb }, () => {
  let app;
  before(async () => { await resetDatabase(); app = makeApp(); });
  after(closeDb);

  test('4.5b summary: Operations matches the seed (worked out by hand)', async () => {
    // EN: Ahmed: Fire Safety overdue 10 days + Code of Conduct due today        -> assigned 1, overdue 1
    //     Sara: Fire Safety completed + its renewal + Data Protection (in 20 d) -> assigned 2, completed 1
    //     Youssef: Forklift + First Aid completed, both renewed                 -> assigned 2, completed 2
    //     Mona (manager): nothing assigned                                      -> zeros
    // Franco: nafs el 7esba bel 3araby fo2: Ahmed overdue wa7ed, Sara w Youssef malhomsh overdue, Mona asfar.
    const res = await call(app, 'GET', `/api/teams/${IDS.OPS}/summary`, { token: tokens.mona() });
    assert.equal(res.status, 200);
    assert.equal(res.body.teamName, 'Operations');
    assert.equal(res.body.today, todayUtc());
    assert.deepEqual(res.body.totals, { employees: 4, assigned: 5, overdue: 1, completed: 3, employeesWithOverdue: 1 });
    const byName = Object.fromEntries(res.body.employees.map((r) => [r.name, r]));
    assert.equal(res.body.employees[0].name, 'Ahmed Ali'); // EN: most urgent first / Franco: el a7waj el awel
    assert.deepEqual([byName['Ahmed Ali'].assigned, byName['Ahmed Ali'].overdue, byName['Ahmed Ali'].maxDaysOverdue], [1, 1, 10]);
    assert.equal(byName['Ahmed Ali'].nextDueDate, todayUtc());
    assert.deepEqual([byName['Sara Mahmoud'].assigned, byName['Sara Mahmoud'].completed], [2, 1]);
    assert.deepEqual([byName['Youssef Adel'].assigned, byName['Youssef Adel'].completed], [2, 2]);
    assert.deepEqual([byName['Mona Hassan'].assigned, byName['Mona Hassan'].overdue, byName['Mona Hassan'].completed], [0, 0, 0]);
    assert.equal(byName['Mona Hassan'].role, 'Manager');
  });

  test('4.5b summary: the numbers match the team assignments list (same calculated status)', async () => {
    const [summary, list] = await Promise.all([
      call(app, 'GET', `/api/teams/${IDS.LAB}/summary`, { token: tokens.omar() }),
      call(app, 'GET', `/api/teams/${IDS.LAB}/assignments`, { token: tokens.omar() }),
    ]);
    const count = (s) => list.body.filter((a) => a.status === s).length;
    assert.deepEqual(summary.body.totals,
      { employees: 4, assigned: count('Assigned'), overdue: count('Overdue'), completed: count('Completed'), employeesWithOverdue: 2 });
    // EN: Laboratory: Nour's renewal is 35 days late, Tarek's training 1 day late -> Nour first.
    // Franco: Laboratory: el renewal bta3 Nour met2akhar 35 yom, w Tarek yom wa7ed -> Nour el awel.
    assert.deepEqual(summary.body.employees.slice(0, 2).map((r) => [r.name, r.maxDaysOverdue]), [['Nour Ibrahim', 35], ['Tarek Samir', 1]]);
  });

  test('4.5b summary: Service token -> 200', async () => {
    assert.equal((await call(app, 'GET', `/api/teams/${IDS.OPS}/summary`, { token: tokens.service() })).status, 200);
  });

  test('4.5b summary: other manager -> 403, employee -> 403, unknown -> 404, malformed -> 400, no token -> 401', async () => {
    assert.equal((await call(app, 'GET', `/api/teams/${IDS.OPS}/summary`, { token: tokens.omar() })).status, 403);
    assert.equal((await call(app, 'GET', `/api/teams/${IDS.OPS}/summary`, { token: tokens.ahmed() })).status, 403);
    assert.equal((await call(app, 'GET', `/api/teams/${IDS.UNKNOWN_TEAM}/summary`, { token: tokens.mona() })).status, 404);
    assert.equal((await call(app, 'GET', '/api/teams/ops/summary', { token: tokens.mona() })).status, 400);
    assert.equal((await call(app, 'GET', `/api/teams/${IDS.OPS}/summary`)).status, 401);
  });
});
