// EN: Assignment endpoints (docs/API_CONTRACT.md 4.9, 4.10 and 4.11). A manager assigns a training to one
//     employee of THEIR team, or to the whole team; everyone reads their own assignments with a calculated
//     status (Assigned / Completed / Overdue).
// Franco: Endpoints el assignments (el contract 4.9 w 4.10). El manager bey-assign training le mowazzaf
//     wa7ed fe team-O, aw lel team kollo; w kol wa7ed bye2ra el assignments bta3to bel status el
//     mat7soob (Assigned / Completed / Overdue).
'use strict';
const express = require('express');
const { badRequest, notFound, forbidden, conflict } = require('../../../common/errors');
const { requireUuid, requireBody } = require('../validate');
const { isValidDate, nextDueDate } = require('../rules');
const { wrap } = require('./employees');

// EN: read and check the POST body: exactly ONE of employeeId / teamId, a trainingId, and a dueDate that is
//     a real date and today or later (UTC). Anything else -> 400 with the field name.
// Franco: ne2ra w n-check el body: WA7ED BAS men employeeId / teamId, w trainingId, w dueDate tareekh
//     7a2i2i w el naharda aw ba3daha (UTC). Ay 7aga tanya -> 400 ma3 esm el field.
function readAssignBody(body, today) {
  requireBody(body);
  const hasEmployee = body.employeeId !== undefined;
  const hasTeam = body.teamId !== undefined;
  if (hasEmployee === hasTeam) {
    throw badRequest('Give exactly one of employeeId or teamId', [{ field: 'employeeId', issue: 'exactly one of employeeId / teamId' }]);
  }
  const trainingId = requireUuid(body.trainingId, 'trainingId');
  if (!isValidDate(body.dueDate)) {
    throw badRequest('dueDate must be a real date written YYYY-MM-DD', [{ field: 'dueDate', issue: 'not a valid date' }]);
  }
  if (body.dueDate < today) {
    throw badRequest('dueDate must be today or later', [{ field: 'dueDate', issue: 'in the past' }]);
  }
  return {
    employeeId: hasEmployee ? requireUuid(body.employeeId, 'employeeId') : null,
    teamId: hasTeam ? requireUuid(body.teamId, 'teamId') : null,
    trainingId,
    dueDate: body.dueDate,
  };
}

function createAssignmentsRouter({ auth, repo, access, today }) {
  const router = express.Router();

  // EN: 4.9 POST /api/assignments: Manager only, and only for THEIR OWN team.
  // Franco: 4.9: lel Manager bas, w le team-O HOWA bas.
  router.post('/api/assignments', auth.requireAuth(['Manager']), wrap(async (req, res) => {
    const day = today();
    const input = readAssignBody(req.body, day);
    const managerId = access.callerEmployeeId(req);

    const training = await repo.getTraining(input.trainingId);
    if (!training) throw notFound('Training not found');

    // ---------------------------------------------------- one employee
    if (input.employeeId) {
      // EN: Security check (ownership): the employee must exist (404) and be in the caller's team (403).
      // Franco: Check amn (ownership): el mowazzaf lazem yeb2a mawgood (404) w fe team el caller (403).
      const employee = await repo.getEmployee(input.employeeId);
      if (!employee) throw notFound('Employee not found');
      if (employee.managerId !== managerId) throw forbidden('You can only assign trainings to your own team');

      const id = await repo.insertAssignment({ ...input, assignedBy: managerId });
      // EN: RULE: one OPEN assignment per training per employee -> a second one is 409.
      // Franco: RULE: assignment wa7ed MAFTOO7 le kol training lel mowazzaf -> el tani 409.
      if (!id) throw conflict('This employee already has an open assignment of this training');
      return res.status(201).json(await repo.getAssignment(id, day));
    }

    // ---------------------------------------------------- whole team
    // EN: Security check (ownership): the team must exist (404) and the caller must manage it (403).
    // Franco: Check amn (ownership): el team lazem yeb2a mawgood (404) w el caller howa el manager (403).
    await access.assertTeamAccess(req, input.teamId);
    const members = await repo.listTeamEmployees(input.teamId);

    // EN: one transaction: members who already have it open are SKIPPED (not an error), the rest get it.
    // Franco: transaction wa7da: elly 3ando el training maftoo7 beyet-SKIP (mesh error), w el ba2y yakhdo.
    const { createdIds, skipped } = await repo.withTransaction(async (tx) => {
      const ids = [];
      const skip = [];
      for (const m of members) {
        const id = await repo.insertAssignment({ employeeId: m.id, trainingId: input.trainingId, assignedBy: managerId, dueDate: input.dueDate }, tx);
        if (id) ids.push(id); else skip.push({ employeeId: m.id, reason: 'OPEN_ASSIGNMENT_EXISTS' });
      }
      return { createdIds: ids, skipped: skip };
    });
    return res.status(201).json({ created: await repo.getAssignmentsByIds(createdIds, day), skipped });
  }));

  // EN: 4.10 GET /api/assignments/me: the caller's own assignments. "me" comes ONLY from the token.
  // Franco: 4.10: el assignments bta3et el caller nafso. "me" gaya men el TOKEN bas.
  router.get('/api/assignments/me', auth.requireAuth(['Employee', 'Manager']), wrap(async (req, res) => {
    res.json(await repo.listAssignmentsOfEmployee(access.callerEmployeeId(req), today()));
  }));

  // EN: 4.11 PATCH /api/assignments/{id}/complete: the employee marks THEIR OWN training as completed.
  //     Security check (ownership): the employee id comes from the TOKEN, never from the URL or the body,
  //     and the assignment must belong to that employee. Nobody can complete it for someone else, not even
  //     their manager (403).
  // Franco: 4.11: el mowazzaf bey2ool en el training BTA3O khelset. Check amn (ownership): el employee id
  //     men el TOKEN, 3omro ma men el URL wala el body, w el assignment lazem yeb2a bta3 el mowazzaf da.
  //     Ma7addesh ye2fel assignment le 7ad tany, 7atta el manager bta3o (403).
  router.patch('/api/assignments/:id/complete', auth.requireAuth(['Employee', 'Manager']), wrap(async (req, res) => {
    const id = requireUuid(req.params.id, 'id');
    const me = access.callerEmployeeId(req);
    const day = today();

    const assignment = await repo.getAssignment(id, day);
    if (!assignment) throw notFound('Assignment not found');
    if (assignment.employeeId !== me) throw forbidden('You can only complete your own assignments');
    if (assignment.completedAt) throw conflict('This assignment is already completed');

    // EN: one transaction: close this assignment AND (if the training expires) create the renewal.
    //     Either both happen or neither does.
    // Franco: transaction wa7da: ne2fel el assignment W (law el training leha sala7eya) ne3mel el renewal.
    //     Ya el etnein ye7salo ya wala wa7ed.
    const result = await repo.withTransaction(async (tx) => {
      const closed = await repo.completeAssignment(id, me, tx);
      // EN: closed by another request a moment ago -> 409, same as above.
      // Franco: et2afal men request tany men lahza -> 409, zay foo2.
      if (!closed) throw conflict('This assignment is already completed');

      // EN: RULE "renewal": a training with validityMonths gets its next assignment automatically, due
      //     completedAt + validityMonths (rules.js nextDueDate), linked with renewalOfId. Same manager as before.
      // Franco: RULE "el renewal": training leha validityMonths biyetfete7laha assignment gedeed lewa7do,
      //     ma3ado completedAt + validityMonths (nextDueDate fe rules.js), marboot b renewalOfId. Nafs el manager.
      let renewalId = null;
      if (closed.validity_months) {
        renewalId = await repo.insertAssignment({
          employeeId: me,
          trainingId: closed.training_id,
          assignedBy: closed.assigned_by,
          dueDate: nextDueDate(closed.completed_at, closed.validity_months),
          renewalOfId: id,
        }, tx);
      }
      return { renewalId };
    });

    res.json({
      completed: await repo.getAssignment(id, day),
      renewal: result.renewalId ? await repo.getAssignment(result.renewalId, day) : null,
    });
  }));

  return router;
}

module.exports = { createAssignmentsRouter, readAssignBody };
