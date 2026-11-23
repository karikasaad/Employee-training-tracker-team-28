// EN: Employee lookup endpoints (docs/API_CONTRACT.md 4.1, 4.2). S2 and S3 call these to find out who
//     the caller is and which team an employee belongs to.
// Franco: Endpoints el bahth 3an el mowazzafeen (el contract 4.1, 4.2). S2 w S3 beyenadoha 3ashan ye3rafo
//     meen el caller w el mowazzaf fe anhi team.
'use strict';
const express = require('express');
const { notFound } = require('../../../common/errors');
const { requireUuid } = require('../validate');

// EN: Express 4 does not catch errors from async handlers; this sends them to the error handler.
// Franco: Express 4 mabyemsoksh errors el async handlers; da beywaddeehom lel error handler.
const wrap = (fn) => (req, res, next) => fn(req, res).catch(next);

function createEmployeesRouter({ auth, repo, access }) {
  const router = express.Router();

  // EN: 4.1 GET /api/employees/me: the caller's own profile. Who "me" is comes ONLY from the token.
  //     Valid token but no employee row for this Cognito user -> 404 (user not provisioned).
  // Franco: 4.1: profile el caller nafso. "me" meen gaya men el TOKEN bas.
  //     Token sa7 bas mafeesh row lel user da -> 404 (el user mesh met-gahhez).
  router.get('/api/employees/me', auth.requireAuth(['Employee', 'Manager']), wrap(async (req, res) => {
    if (!req.user.employeeId) throw notFound('No employee profile for this user');
    const me = await repo.getEmployee(req.user.employeeId);
    if (!me) throw notFound('No employee profile for this user');
    res.json(me);
  }));

  // EN: 4.2 GET /api/employees/{id}: the employee themself, their team's manager, or the Service token.
  // Franco: 4.2: el mowazzaf nafso, aw manager el team bta3o, aw el Service token.
  router.get('/api/employees/:id', auth.requireAuth(['Employee', 'Manager', 'Service']), wrap(async (req, res) => {
    const id = requireUuid(req.params.id, 'id');
    res.json(await access.assertEmployeeAccess(req, id));
  }));

  return router;
}

module.exports = { createEmployeesRouter, wrap };
