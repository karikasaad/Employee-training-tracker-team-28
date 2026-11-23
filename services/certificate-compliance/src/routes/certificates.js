// EN: Certificate endpoints of Service 2. This file: POST /api/certificates (upload).
// Franco: Endpoints el certificates fe Service 2. El file da: POST /api/certificates (upload).
'use strict';
const crypto = require('node:crypto');
const express = require('express');
const { badRequest, unsupportedMediaType } = require('../../../common/errors');
const { detectMimeType } = require('../fileType');
const { validateUpload } = require('../validate');
const { toCertificate } = require('../certificate');
const { singleFileUpload } = require('../upload');

// EN: the caller's token, to forward it to S1. requireAuth already proved the header is well formed.
// Franco: token el caller, 3ashan nebaa3to le S1. requireAuth asln etakked en el header sa7.
function bearerToken(req) {
  return (req.headers.authorization || '').slice('Bearer '.length);
}

function createCertificatesRouter({ auth, upstream, storage, repo, today }) {
  const router = express.Router();

  // EN: POST /api/certificates. The order of the checks matters:
  //     1) login + role (401/403) BEFORE we accept any bytes; 2) size (413) while reading;
  //     3) form fields (400); 4) real file type (415); 5) training exists (404); 6) store file; 7) save row.
  // Franco: POST /api/certificates. Tarteeb el checks mohem:
  //     1) login + role (401/403) ABL ma nesta2bel ay bytes; 2) el hagm (413) wa7na bn2ra;
  //     3) el fields (400); 4) noo3 el file el 7a2i2i (415); 5) el training mawgood (404); 6) n-khazzen el file; 7) nesgel el satr.
  router.post(
    '/api/certificates',
    auth.requireAuth(['Employee', 'Manager']),
    singleFileUpload(),
    async (req, res, next) => {
      try {
        if (!req.file) throw badRequest('A file is required in the field "file"');
        if (req.file.size === 0) throw badRequest('The file is empty');
        const fields = validateUpload(req.body || {});

        // EN: SECURITY: the type comes from the first bytes, not from the name or Content-Type.
        // Franco: AMAN: el noo3 men awel bytes, mesh men el esm wala el Content-Type.
        const mimeType = detectMimeType(req.file.buffer);
        if (!mimeType) throw unsupportedMediaType('Only PDF, JPEG and PNG files are allowed');

        // EN: SECURITY: the owner is the caller, found by S1 from the token. The form has no employeeId.
        // Franco: AMAN: el sa7eb howa el caller, S1 beylaqeeh men el token. El form mafeehash employeeId.
        const ctx = { token: bearerToken(req), requestId: req.requestId };
        const me = await upstream.getMe(ctx);
        await upstream.getTraining(fields.trainingId, ctx);

        // EN: random key (never the user's file name) and a SHA-256 hash to detect later changes.
        // Franco: key 3ashwa2i (3omro ma yeb2a esm el user) w hash SHA-256 3ashan nalta2i ay taghyeer ba3den.
        const s3Key = `certificates/${crypto.randomUUID()}`;
        const fileHash = crypto.createHash('sha256').update(req.file.buffer).digest('hex');
        await storage.put(s3Key, req.file.buffer, mimeType);

        let row;
        try {
          row = await repo.insertCertificate({
            ...fields, employeeId: me.id, s3Key, fileHash, mimeType, sizeBytes: req.file.size,
          }, req.ip);
        } catch (err) {
          // EN: the row was not saved, so delete the file we just stored (no orphan files).
          // Franco: el satr mat-sagalsh, f nems7 el file elly kheznnah (mafeesh files yateema).
          await storage.remove(s3Key).catch(() => {});
          throw err;
        }
        return res.status(201).json(toCertificate(row, today()));
      } catch (err) {
        return next(err);
      }
    },
  );

  return router;
}

module.exports = { createCertificatesRouter };
