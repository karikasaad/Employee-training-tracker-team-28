// EN: Compliance endpoints of Service 2. This file: GET /api/compliance/teams/{teamId} (5.9), the answer that
//     Service 3 (the manager dashboard) reads.
// Franco: Endpoints el compliance fe Service 2. El file da: GET /api/compliance/teams/{teamId} (5.9), el rad
//     elly Service 3 (dashboard el manager) bey2rah.
'use strict';
const express = require('express');
const { buildTeamCompliance } = require('../compliance');

function createComplianceRouter({ auth, upstream, repo, access, today, now }) {
  const router = express.Router();

  // EN: Who may ask: the manager of {teamId}, or the Service token (the daily jobs). The team check goes
  //     through S1 and works for both (S1 lists only the caller's teams for a manager, all teams for Service).
  //     Then: employees and completed assignments from S1 (the caller's own token is forwarded), certificates
  //     and open flags from our database, and the pure rules in compliance.js decide the flags.
  // Franco: Meen yeqdar yes2al: manager el {teamId}, aw Service token (el jobs el yomeya). Check el team beyemshi
  //     3an taree2 S1 w beyeshtaghal lel etneen (S1 beyrga3 teams el manager bas, w kol el teams lel Service).
  //     Ba3den: el mowazzafeen w el assignments el completed men S1 (bn-forward token el caller nafso), w
  //     el certificates w el flags el maftoo7a men el database bta3etna, w el rules fe compliance.js bet-qarrar el flags.
  router.get('/api/compliance/teams/:teamId', auth.requireAuth(['Manager', 'Service']), async (req, res, next) => {
    try {
      const employees = await access.teamEmployeesOfManager(req, req.params.teamId);
      const teamId = access.requireUuid(req.params.teamId, 'teamId');
      const assignments = await upstream.getTeamCompletedAssignments(teamId, access.ctxOf(req));

      const ids = employees.map((e) => e.id);
      const certRows = ids.length ? await repo.listByEmployees(ids, null) : [];
      const openFlagRows = ids.length ? await repo.openFlags(ids) : [];

      return res.json(buildTeamCompliance({
        teamId, employees, certRows, assignments, openFlagRows, today: today(), nowIso: now().toISOString(),
      }));
    } catch (err) {
      return next(err);
    }
  });

  return router;
}

module.exports = { createComplianceRouter };
