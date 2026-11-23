// EN: Ownership checks for Service 1, in ONE place so every route uses the same rules:
//       - who is calling (employee id comes from the TOKEN, never from the URL or the body);
//       - "manager of team X" = teams.manager_id equals the caller's employee id;
//       - a Service token (daily jobs) may read every team.
// Franco: Checks el ownership fe Service 1, fe makan WA7ED 3ashan kol route yesta3mel nafs el rules:
//       - meen elly beyetlob (el employee id men el TOKEN, 3omro ma men el URL wala el body);
//       - "manager el team X" = teams.manager_id beyesawy el employee id bta3 el caller;
//       - el Service token (el jobs el yomeya) yeqdar ye2ra kol el teams.
'use strict';
const { forbidden, notFound } = require('../../common/errors');

function createAccess(repo) {
  // EN: the caller's employee id. A person whose Cognito user has no employee row cannot use S1 (403).
  // Franco: el employee id bta3 el caller. Law el user fe Cognito malhoosh row fel employees mayenfa3sh
  //     yesta3mel S1 (403).
  function callerEmployeeId(req) {
    if (!req.user.employeeId) throw forbidden('Your account has no employee profile');
    return req.user.employeeId;
  }

  // EN: Security check (team ownership): the team must exist (404) and the caller must be its manager,
  //     or the request must use the Service token. Anyone else gets 403, including the manager of another team.
  // Franco: Check amn (ownership el team): el team lazem yeb2a mawgood (404) w el caller howa el manager
  //     bta3o, aw el request bel Service token. Ay 7ad tany yakhod 403, 7atta manager team tany.
  async function assertTeamAccess(req, teamId) {
    const team = await repo.getTeam(teamId);
    if (!team) throw notFound('Team not found');
    if (req.user.isService) return team;
    if (team.managerId !== callerEmployeeId(req)) throw forbidden('You are not the manager of this team');
    return team;
  }

  // EN: Security check (employee record): allowed for the employee themself, the manager of the
  //     employee's team, or the Service token. Unknown id -> 404, anyone else -> 403.
  // Franco: Check amn (bayanat mowazzaf): masmoo7 lel mowazzaf nafso, aw manager el team bta3o, aw el
  //     Service token. Id mesh mawgood -> 404, ay 7ad tany -> 403.
  async function assertEmployeeAccess(req, employeeId) {
    const employee = await repo.getEmployee(employeeId);
    if (!employee) throw notFound('Employee not found');
    if (req.user.isService) return employee;
    const me = callerEmployeeId(req);
    if (employee.id === me || employee.managerId === me) return employee;
    throw forbidden('You may only see your own profile or your team members');
  }

  return { callerEmployeeId, assertTeamAccess, assertEmployeeAccess };
}

module.exports = { createAccess };
