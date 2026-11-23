// EN: Training catalogue endpoints (docs/API_CONTRACT.md 4.6-4.8 and 4.6b).
//     Create and edit: Manager only. Read: Employees and Managers (S2 also reads one training with the
//     uploader's token or the Service token to check it exists and whether it needs a certificate).
// Franco: Endpoints katalog el trainings (el contract 4.6-4.8 w 4.6b).
//     El create w el edit: lel Manager bas. El qeraya: lel Employee w el Manager (w S2 bte2ra training
//     wa7ed bel token bta3 el mowazzaf aw el Service token 3ashan tet2akked enno mawgood).
'use strict';
const express = require('express');
const { badRequest, notFound, forbidden, conflict } = require('../../../common/errors');
const { PG } = require('../../../common/db');
const { requireUuid, requireBody, requireText, optionalBoolean, optionalInt } = require('../validate');
const { wrap } = require('./employees');

// EN: the four fields a manager can set, checked the same way for create and edit.
//     name 1-150 chars, category 1-50 chars, requiresCertificate true/false (default false),
//     validityMonths 1-120 or null (null = never expires; used by the renewal rule later).
// Franco: el 4 fields elly el manager yeqdar yeghayyarhom, bet-et-check benafs el tare2a fel create w el edit.
function readTrainingFields(body) {
  requireBody(body);
  return {
    name: requireText(body.name, 'name', { max: 150 }),
    category: requireText(body.category, 'category', { max: 50 }),
    requiresCertificate: optionalBoolean(body.requiresCertificate, 'requiresCertificate', false),
    validityMonths: optionalInt(body.validityMonths, 'validityMonths', { min: 1, max: 120, nullable: true }),
  };
}

// EN: training names are unique (database UNIQUE constraint) -> a duplicate becomes 409, not 500.
// Franco: asamy el trainings unique (fel database) -> el takraar beyb2a 409 mesh 500.
function duplicateNameToConflict(err) {
  if (err && err.code === PG.UNIQUE_VIOLATION) throw conflict('A training with this name already exists');
  throw err;
}

function createTrainingsRouter({ auth, repo, access }) {
  const router = express.Router();

  // EN: Security check (role): only Managers create or edit trainings; an Employee gets 403.
  // Franco: Check amn (el role): el Manager bas ye3mel aw ye3addel training; el Employee yakhod 403.
  const managerOnly = auth.requireAuth(['Manager']);

  // EN: 4.6 POST /api/trainings: create a training. created_by = the caller (from the token).
  // Franco: 4.6: training gedeed. created_by = el caller (men el token).
  router.post('/api/trainings', managerOnly, wrap(async (req, res) => {
    const fields = readTrainingFields(req.body);
    const created = await repo
      .createTraining({ ...fields, createdBy: access.callerEmployeeId(req) })
      .catch(duplicateNameToConflict);
    res.status(201).json(created);
  }));

  // EN: 4.7 GET /api/trainings?category=: list, optionally one category (exact match, 1-50 chars).
  // Franco: 4.7: el list, w momken category wa7da bas (match bel zabt, 1-50 7arf).
  router.get('/api/trainings', auth.requireAuth(['Employee', 'Manager']), wrap(async (req, res) => {
    let category = null;
    if (req.query.category !== undefined) {
      if (Array.isArray(req.query.category)) throw badRequest('category must be given once', [{ field: 'category', issue: 'repeated' }]);
      category = requireText(req.query.category, 'category', { max: 50 });
    }
    res.json(await repo.listTrainings(category));
  }));

  // EN: 4.8 GET /api/trainings/{id}: one training (S2 uses it before accepting a certificate upload).
  // Franco: 4.8: training wa7ed (S2 btesta3melo abl ma te2bal upload certificate).
  router.get('/api/trainings/:id', auth.requireAuth(['Employee', 'Manager', 'Service']), wrap(async (req, res) => {
    const training = await repo.getTraining(requireUuid(req.params.id, 'id'));
    if (!training) throw notFound('Training not found');
    res.json(training);
  }));

  // EN: 4.6b PUT /api/trainings/{id}: edit a training. Security check (ownership): only the manager who
  //     CREATED the training may change it; another manager gets 403. Changes apply to future
  //     assignments and renewals; past completions are not rewritten.
  // Franco: 4.6b: ta3deel training. Check amn (ownership): el manager elly 3AMAL el training bas yeqdar
  //     yeghayyaro; manager tany yakhod 403. El taghyeer beyeslla2 3ala el assignments w el renewals el
  //     gayya; el 7agat elly khelset mabtetghayyarsh.
  router.put('/api/trainings/:id', managerOnly, wrap(async (req, res) => {
    const id = requireUuid(req.params.id, 'id');
    const fields = readTrainingFields(req.body);
    const existing = await repo.getTraining(id);
    if (!existing) throw notFound('Training not found');
    if (existing.createdBy !== access.callerEmployeeId(req)) {
      throw forbidden('Only the manager who created this training can edit it');
    }
    res.json(await repo.updateTraining(id, fields).catch(duplicateNameToConflict));
  }));

  return router;
}

module.exports = { createTrainingsRouter, readTrainingFields };
