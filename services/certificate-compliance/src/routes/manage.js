// EN: Certificate endpoints of Service 2 that work on EXISTING certificates:
//     GET /api/certificates?teamId=&reviewStatus= (5.3), GET /api/certificates/{id} (5.4),
//     PUT /api/certificates/{id} (5.5), DELETE /api/certificates/{id} (5.8).
// Franco: Endpoints el certificates elly beyeshta3'alo 3ala certificates MAWGOODA:
//     GET list (5.3), GET wa7ed (5.4), PUT (5.5), DELETE (5.8).
'use strict';
const express = require('express');
const { badRequest, conflict, notFound } = require('../../../common/errors');
const { validateUpdate } = require('../validate');
const { toCertificate } = require('../certificate');

const REVIEW_STATUSES = ['Pending', 'Verified', 'Rejected'];

function createManageRouter({ auth, repo, access, today }) {
  const router = express.Router();

  // EN: 5.3 The team list / verify queue. Only the manager of {teamId} (role AND team are checked).
  // Franco: 5.3 List el team / tabour el verify. Manager el {teamId} bas (el role W el team bey-et-check).
  router.get('/api/certificates', auth.requireAuth(['Manager']), async (req, res, next) => {
    try {
      const { teamId, reviewStatus } = req.query;
      if (teamId === undefined) throw badRequest('teamId is required', [{ field: 'teamId', issue: 'is required' }]);
      if (reviewStatus !== undefined && !REVIEW_STATUSES.includes(reviewStatus)) {
        throw badRequest('reviewStatus must be Pending, Verified or Rejected', [{ field: 'reviewStatus', issue: 'not allowed' }]);
      }
      const employees = await access.teamEmployeesOfManager(req, teamId);
      const ids = employees.map((e) => e.id);
      const rows = ids.length ? await repo.listByEmployees(ids, reviewStatus || null) : [];
      return res.json(rows.map((row) => toCertificate(row, today())));
    } catch (err) {
      return next(err);
    }
  });

  // EN: 5.4 One certificate: the owner or the manager of the owner's team.
  // Franco: 5.4 certificate wa7ed: el sa7eb aw manager team el sa7eb.
  router.get('/api/certificates/:id', auth.requireAuth(['Employee', 'Manager']), async (req, res, next) => {
    try {
      const { row } = await access.loadCertificate(req, req.params.id);
      return res.json(toCertificate(row, today()));
    } catch (err) {
      return next(err);
    }
  });

  // EN: 5.5 Edit texts and dates. Business rules: ONLY the owner (not even their manager), and ONLY while
  //     Pending (409 afterwards). The file, the owner and the status can never be changed here.
  // Franco: 5.5 ta3deel el nosoos w el tawareekh. El rules: el SA7EB bas (7atta manager-o la2), w bas lama
  //     yeb2a Pending (409 ba3dein). El file w el sa7eb w el status mayet3'ayaroosh hena abadan.
  router.put('/api/certificates/:id', auth.requireAuth(['Employee', 'Manager']), async (req, res, next) => {
    try {
      const { row, me, isOwner } = await access.loadCertificate(req, req.params.id, 'update');
      if (!isOwner) await access.deny(req, me, 'update', row.id, 'Only the owner can edit a certificate');
      const fields = validateUpdate(req.body || {});
      const updated = await repo.updateIfPending(row.id, fields, me.id, req.ip);
      if (!updated) throw conflict('Only a Pending certificate can be edited');
      return res.json(toCertificate(updated, today()));
    } catch (err) {
      return next(err);
    }
  });

  // EN: 5.8 Soft delete. Business rules: the owner only while Pending; the manager of the owner's team any time.
  // Franco: 5.8 Soft delete. El rules: el sa7eb bas lama yeb2a Pending; manager team el sa7eb fe ay wa2t.
  router.delete('/api/certificates/:id', auth.requireAuth(['Employee', 'Manager']), async (req, res, next) => {
    try {
      const { row, me, isOwner } = await access.loadCertificate(req, req.params.id, 'delete');
      if (isOwner && row.review_status !== 'Pending') {
        await access.deny(req, me, 'delete', row.id, 'You can only delete a Pending certificate');
      }
      const deleted = await repo.softDelete(row.id, me.id, req.ip);
      if (!deleted) throw notFound('Certificate not found'); // EN: deleted a moment ago / Franco: etmasa7 men lahza
      return res.status(204).end();
    } catch (err) {
      return next(err);
    }
  });

  return router;
}

module.exports = { createManageRouter };
