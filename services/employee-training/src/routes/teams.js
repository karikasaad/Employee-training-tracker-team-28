// EN: Team endpoints (docs/API_CONTRACT.md 4.3, 4.4, 4.5 and 4.5b). S2 and S3 use GET /api/teams for their own
//     ownership checks: it only ever returns the teams the caller manages.
// Franco: Endpoints el teams (el contract 4.3, 4.4, 4.5 w 4.5b). S2 w S3 beyesta3melo GET /api/teams fel ownership
//     checks bta3thom: beyrga3 bas el teams elly el caller modeerha.
'use strict';
const express = require('express');
const { badRequest } = require('../../../common/errors');
const { requireUuid } = require('../validate');
const { summarizeTeam } = require('../summary');
const { wrap } = require('./employees');

// EN: the allowed ?status= values (lower case in the URL) -> the calculated status they select.
// Franco: el values el masmoo7a fe ?status= (small letters fel URL) -> el status el mat7soob.
const STATUS_FILTER = { overdue: 'Overdue', completed: 'Completed', assigned: 'Assigned' };

function createTeamsRouter({ auth, repo, access, today }) {
  const router = express.Router();

  // EN: Security check (role): Employees get 403 here; only Managers and the Service token may enter.
  // Franco: Check amn (el role): el Employee yakhod 403 hena; el Manager w el Service token bas.
  const managerOrService = auth.requireAuth(['Manager', 'Service']);

  // EN: 4.3 GET /api/teams: a Manager gets only their own teams, the Service token gets every team.
  // Franco: 4.3: el Manager yakhod el teams bta3to bas, w el Service token yakhod kol el teams.
  router.get('/api/teams', managerOrService, wrap(async (req, res) => {
    if (req.user.isService) return res.json(await repo.listAllTeams());
    return res.json(await repo.listTeamsManagedBy(access.callerEmployeeId(req)));
  }));

  // EN: 4.4 GET /api/teams/{teamId}/employees: only the manager of THIS team (or the Service token).
  //     The manager of another team gets 403; an unknown team gets 404.
  // Franco: 4.4: manager el team DA bas (aw el Service token). Manager team tany yakhod 403; team mesh
  //     mawgood yakhod 404.
  router.get('/api/teams/:teamId/employees', managerOrService, wrap(async (req, res) => {
    const teamId = requireUuid(req.params.teamId, 'teamId');
    await access.assertTeamAccess(req, teamId);
    res.json(await repo.listTeamEmployees(teamId));
  }));

  // EN: 4.5 GET /api/teams/{teamId}/assignments?status=: the team view with the CALCULATED status.
  //     Only the manager of THIS team (or the Service token, used by S2/S3 daily jobs). S3 calls it
  //     without ?status to compute compliance. The filter is applied to the calculated status, so
  //     "overdue" uses exactly the same rule as everywhere else (rules.js).
  // Franco: 4.5: view el team bel status el MAT7SOOB. Manager el team DA bas (aw el Service token lel
  //     jobs bta3et S2/S3). S3 betnadeeha men gheir ?status 3ashan te7seb el compliance. El filter
  //     beyetla2 3ala el status el mat7soob, f "overdue" nafs el rule bel zabt (rules.js).
  router.get('/api/teams/:teamId/assignments', managerOrService, wrap(async (req, res) => {
    const teamId = requireUuid(req.params.teamId, 'teamId');
    let wanted = null;
    if (req.query.status !== undefined) {
      const key = typeof req.query.status === 'string' ? req.query.status.toLowerCase() : '';
      wanted = STATUS_FILTER[key];
      if (!wanted) throw badRequest('status must be overdue, completed or assigned', [{ field: 'status', issue: 'unknown value' }]);
    }
    await access.assertTeamAccess(req, teamId);
    const all = await repo.listAssignmentsOfTeam(teamId, today());
    res.json(wanted ? all.filter((a) => a.status === wanted) : all);
  }));

  // EN: 4.5b GET /api/teams/{teamId}/summary: per member counts (Assigned / Overdue / Completed) for the
  //     manager's team page. Same security as 4.5: only the manager of THIS team, or the Service token.
  // Franco: 4.5b: ar2am le kol mowazzaf (Assigned / Overdue / Completed) le safhet el team bta3et el
  //     manager. Nafs amn 4.5: manager el team DA bas, aw el Service token.
  router.get('/api/teams/:teamId/summary', managerOrService, wrap(async (req, res) => {
    const teamId = requireUuid(req.params.teamId, 'teamId');
    const team = await access.assertTeamAccess(req, teamId);
    const day = today();
    const [employees, assignments] = await Promise.all([
      repo.listTeamEmployees(teamId),
      repo.listAssignmentsOfTeam(teamId, day),
    ]);
    res.json({ teamId: team.id, teamName: team.name, today: day, ...summarizeTeam(employees, assignments) });
  }));

  return router;
}

module.exports = { createTeamsRouter, STATUS_FILTER };
