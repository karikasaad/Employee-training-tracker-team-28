// EN: Team endpoints (docs/API_CONTRACT.md 4.3, 4.4). S2 and S3 use GET /api/teams for their own
//     ownership checks: it only ever returns the teams the caller manages.
// Franco: Endpoints el teams (el contract 4.3, 4.4). S2 w S3 beyesta3melo GET /api/teams fel ownership
//     checks bta3thom: beyrga3 bas el teams elly el caller modeerha.
'use strict';
const express = require('express');
const { requireUuid } = require('../validate');
const { wrap } = require('./employees');

function createTeamsRouter({ auth, repo, access }) {
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

  return router;
}

module.exports = { createTeamsRouter };
