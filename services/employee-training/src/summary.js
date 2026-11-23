// EN: Team summary for the manager's page: per team member, how many assignments are Assigned, Overdue and
//     Completed, plus team totals. A PURE function (no database), built from the same calculated statuses
//     as everywhere else, so the numbers always match GET /api/teams/{teamId}/assignments.
// Franco: Molakhas el team le safhet el manager: le kol mowazzaf kam assignment Assigned w Overdue w
//     Completed, w magamee3 el team. Function PURE (mafeesh database), ma3mola men nafs el statuses el
//     mat7soba, f el ar2am dayman zay GET /api/teams/{teamId}/assignments.
'use strict';

// EN: employees = team members (Employee JSON); assignments = the team's assignments (Assignment JSON,
//     status already calculated). Every member appears, even with no assignments (all zeros).
// Franco: employees = a3da2 el team; assignments = assignments el team (el status mat7soob). Kol mowazzaf
//     beyezhar 7atta law malosh assignments (kollo asfar).
function summarizeTeam(employees, assignments) {
  const rows = new Map(employees.map((e) => [e.id, {
    employeeId: e.id, name: e.name, role: e.role, assigned: 0, overdue: 0, completed: 0, maxDaysOverdue: 0, nextDueDate: null,
  }]));

  for (const a of assignments) {
    const row = rows.get(a.employeeId);
    if (!row) continue; // EN: not a current member / Franco: mesh 3odw fel team dilwa2ty
    if (a.status === 'Overdue') {
      row.overdue += 1;
      row.maxDaysOverdue = Math.max(row.maxDaysOverdue, a.daysOverdue);
    } else if (a.status === 'Completed') {
      row.completed += 1;
    } else {
      row.assigned += 1;
      // EN: the next deadline = the earliest due date that is not overdue yet.
      // Franco: el ma3ad el gai = a2rab due date lessa mesh overdue.
      if (row.nextDueDate === null || a.dueDate < row.nextDueDate) row.nextDueDate = a.dueDate;
    }
  }

  // EN: most urgent first: more overdue items, then longest overdue, then name (A-Z).
  // Franco: el a7waj el awel: overdue aktar, ba3den el met2akhar aktar, ba3den el esm (A-Z).
  const list = [...rows.values()].sort((x, y) => (y.overdue - x.overdue)
    || (y.maxDaysOverdue - x.maxDaysOverdue)
    || x.name.localeCompare(y.name, 'en'));

  const totals = list.reduce((t, r) => ({
    employees: t.employees + 1,
    assigned: t.assigned + r.assigned,
    overdue: t.overdue + r.overdue,
    completed: t.completed + r.completed,
    employeesWithOverdue: t.employeesWithOverdue + (r.overdue > 0 ? 1 : 0),
  }), { employees: 0, assigned: 0, overdue: 0, completed: 0, employeesWithOverdue: 0 });

  return { totals, employees: list };
}

module.exports = { summarizeTeam };
