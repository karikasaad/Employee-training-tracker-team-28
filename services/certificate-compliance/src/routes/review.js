// EN: Certificate endpoints of Service 2 for download (5.6) and the manager's decision (5.7).
// Franco: Endpoints el certificates fe Service 2 lel download (5.6) w qarar el manager (5.7).
'use strict';
const express = require('express');
const { conflict } = require('../../../common/errors');
const { validateDecision } = require('../validate');
const { extensionOf } = require('../fileType');
const { toCertificate } = require('../certificate');

const DOWNLOAD_SECONDS = 300; // EN: 5 minutes / Franco: 5 da2ay2

function createReviewRouter({ auth, repo, access, storage, today }) {
  const router = express.Router();

  // EN: 5.6 Download. The file is NEVER streamed through this service: we hand out a pre-signed link that
  //     works for 5 minutes and forces a download. Who may ask: the owner or the manager of the owner's team
  //     (same IDOR check as 5.4). Every download is written to the audit log BEFORE the link is given.
  // Franco: 5.6 Download. El file 3omro ma beyetba3at men el service da: bn3ty link m3a tawqee3 beyeshtaghal 5
  //     da2ay2 w beygbor el download. Meen yeqdar yeTlob: el sa7eb aw manager team el sa7eb (nafs check el IDOR
  //     bta3 5.4). Kol download bey-etkteb fel audit log ABL ma n3ty el link.
  router.get('/api/certificates/:id/download', auth.requireAuth(['Employee', 'Manager']), async (req, res, next) => {
    try {
      const { row, me } = await access.loadCertificate(req, req.params.id, 'download');
      // EN: the file name comes from OUR id and the detected type, never from the user's upload name.
      // Franco: esm el file men el id bta3na w el noo3 elly et3araf, 3omro ma yeb2a esm el user.
      const url = await storage.presignedDownloadUrl(row.s3_key, {
        fileName: `certificate-${row.id}${extensionOf(row.mime_type)}`,
        mimeType: row.mime_type,
        expiresIn: DOWNLOAD_SECONDS,
      });
      await repo.audit(me.id, 'download', row.id, req.ip, 'success');
      return res.json({ url, expiresInSeconds: DOWNLOAD_SECONDS });
    } catch (err) {
      return next(err);
    }
  });

  // EN: 5.7 Verify or reject. Business rules:
  //     - only a Manager, and only the manager of the OWNER's team (checked through S1);
  //     - a manager can NEVER decide their own certificate (403);
  //     - only a Pending certificate can be decided (409 afterwards);
  //     - a rejection needs a reason.
  // Franco: 5.7 Verify aw reject. El rules:
  //     - Manager bas, w manager team el SA7EB bas (bey-et-check 3an taree2 S1);
  //     - el manager 3omro ma yeqarrar fe certificate bta3o howa (403);
  //     - el Pending bas yetqarar feeh (409 ba3d keda);
  //     - el reject lazem leh sabab.
  router.patch('/api/certificates/:id/verify', auth.requireAuth(['Manager']), async (req, res, next) => {
    try {
      const { decision, reason } = validateDecision(req.body || {});
      const { row, me, isOwner } = await access.loadCertificate(req, req.params.id, decision);
      if (isOwner) await access.deny(req, me, decision, row.id, 'You cannot verify your own certificate');
      const updated = await repo.decide(row.id, decision, reason, me.id, req.ip);
      if (!updated) throw conflict('Only a Pending certificate can be verified or rejected');
      return res.json(toCertificate(updated, today()));
    } catch (err) {
      return next(err);
    }
  });

  return router;
}

module.exports = { createReviewRouter };
