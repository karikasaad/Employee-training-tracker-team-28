// EN: All SQL of Service 2 lives here. Every value is a $n parameter (services/common/db.js refuses
//     quotes in SQL text), so SQL injection is not possible. S2 connects as the role svc_s2.
// Franco: Kol SQL bta3 Service 2 hena. Kol value $n parameter (services/common/db.js bey-refod el quotes
//     fel SQL), f SQL injection mesh momken. S2 beydkhol bel role svc_s2.
'use strict';

const CERTIFICATE_COLUMNS = `id, employee_id, training_id, title, issuer, certificate_number,
  issue_date::text AS issue_date, expiry_date::text AS expiry_date, review_status, mime_type, size_bytes,
  uploaded_at, verified_by, verified_at, reject_reason`;

// EN: one audit row (docs/API_CONTRACT.md: every change is written to audit_log; the table is append-only).
// Franco: satr audit wa7ed (kol taghyeer bey-etkteb fel audit_log; el gadwal append-only).
const AUDIT_SQL = `INSERT INTO audit_log (actor_id, action, certificate_id, ip_address, result)
                   VALUES ($1, $2, $3, $4, $5)`;

function createRepo(db) {
  // EN: saves the certificate AND its audit row in ONE transaction: both happen or none does.
  //     review_status is not given: the table default is Pending.
  // Franco: beyesgel el certificate W satr el audit fe transaction wa7da: ya el etneen yenga7o ya wala wa7ed.
  //     review_status mabnb3atoosh: el default fel gadwal howa Pending.
  function insertCertificate(c, ip) {
    return db.withTransaction(async (tx) => {
      const row = await tx.queryOne(
        `INSERT INTO certificates (employee_id, training_id, title, issuer, certificate_number, issue_date,
                                   expiry_date, s3_key, file_hash, mime_type, size_bytes)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         RETURNING ${CERTIFICATE_COLUMNS}`,
        [c.employeeId, c.trainingId, c.title, c.issuer, c.certificateNumber, c.issueDate, c.expiryDate,
          c.s3Key, c.fileHash, c.mimeType, c.sizeBytes],
      );
      await tx.query(AUDIT_SQL, [c.employeeId, 'upload', row.id, ip || null, 'success']);
      return row;
    });
  }

  // EN: all NOT deleted certificates of ONE employee, newest first. The employee id is always a parameter.
  // Franco: kol el certificates (elly mesh mem7eyya) bta3et mowazzaf wa7ed, el ag7ad el awel. El employee id dayman parameter.
  function listByEmployee(employeeId) {
    return db.query(
      `SELECT ${CERTIFICATE_COLUMNS} FROM certificates
       WHERE employee_id = $1 AND deleted_at IS NULL
       ORDER BY uploaded_at DESC`,
      [employeeId],
    );
  }

  // EN: one certificate by id. A soft-deleted certificate (deleted_at set) is treated as not found.
  // Franco: certificate wa7ed bel id. El certificate el mem7eyya (deleted_at) beyetsama mesh mawgood.
  function findById(id) {
    return db.queryOne(
      `SELECT ${CERTIFICATE_COLUMNS}, s3_key FROM certificates WHERE id = $1 AND deleted_at IS NULL`,
      [id],
    );
  }

  // EN: certificates of several employees (a team), optionally only one review status.
  // Franco: certificates bta3et kaza mowazzaf (team), w momken noo3 review status wa7ed bas.
  function listByEmployees(employeeIds, reviewStatus) {
    const params = [employeeIds];
    let statusFilter = '';
    if (reviewStatus) {
      params.push(reviewStatus);
      statusFilter = ' AND review_status = $2';
    }
    return db.query(
      `SELECT ${CERTIFICATE_COLUMNS} FROM certificates
       WHERE employee_id = ANY($1::uuid[]) AND deleted_at IS NULL${statusFilter}
       ORDER BY uploaded_at DESC`,
      params,
    );
  }

  // EN: the flags that are still OPEN (resolved_at is empty) for these employees.
  // Franco: el flags elly lessa OPEN (resolved_at fady) le el mowazzafeen dool.
  function openFlags(employeeIds) {
    return db.query(
      `SELECT employee_id, training_id, flag_type, raised_at FROM compliance_flags
       WHERE employee_id = ANY($1::uuid[]) AND resolved_at IS NULL`,
      [employeeIds],
    );
  }

  // EN: edit the dates and texts, but ONLY while the certificate is still Pending. The "Pending" check is
  //     inside the UPDATE itself, so two requests at the same time cannot both succeed after a decision.
  //     Returns the new row, or null when it was not Pending (the route answers 409).
  // Franco: ne3adel el nosoos w el tawareekh, bas LAW el certificate lessa Pending. Check el Pending gowwa
  //     el UPDATE nafso, f talabeen fe nafs el wa2t mayenga7ooshi ba3d el qarar. Beyrga3 el satr el gedeed,
  //     aw null law mesh Pending (el route beyrod 409).
  function updateIfPending(id, f, actorId, ip) {
    return db.withTransaction(async (tx) => {
      const row = await tx.queryOne(
        `UPDATE certificates
         SET title = $2, issuer = $3, certificate_number = $4, issue_date = $5, expiry_date = $6
         WHERE id = $1 AND review_status = $7 AND deleted_at IS NULL
         RETURNING ${CERTIFICATE_COLUMNS}`,
        [id, f.title, f.issuer, f.certificateNumber, f.issueDate, f.expiryDate, 'Pending'],
      );
      if (!row) return null;
      await tx.query(AUDIT_SQL, [actorId, 'update', id, ip || null, 'success']);
      return row;
    });
  }

  // EN: the manager's decision: Verified or Rejected. Like the edit, the "still Pending" check is inside the
  //     UPDATE, so a certificate can be decided only once. Returns the new row, or null (the route answers 409).
  // Franco: qarar el manager: Verified aw Rejected. Zay el edit, check "lessa Pending" gowwa el UPDATE, f el
  //     certificate yetqarar feeh mara wa7da bas. Beyrga3 el satr el gedeed, aw null (el route beyrod 409).
  function decide(id, decision, reason, actorId, ip) {
    const status = decision === 'verify' ? 'Verified' : 'Rejected';
    return db.withTransaction(async (tx) => {
      const row = await tx.queryOne(
        `UPDATE certificates
         SET review_status = $2, verified_by = $3, verified_at = now(), reject_reason = $4
         WHERE id = $1 AND review_status = $5 AND deleted_at IS NULL
         RETURNING ${CERTIFICATE_COLUMNS}`,
        [id, status, actorId, reason, 'Pending'],
      );
      if (!row) return null;
      await tx.query(AUDIT_SQL, [actorId, decision, id, ip || null, 'success']);
      return row;
    });
  }

  // EN: soft delete: the row stays (audit trail), only deleted_at is set. Returns false if already deleted.
  // Franco: soft delete: el satr beyefdal (3ashan el audit), deleted_at bas beyetsagal. Beyrga3 false law etmasa7 abl keda.
  function softDelete(id, actorId, ip) {
    return db.withTransaction(async (tx) => {
      const rows = await tx.query(
        'UPDATE certificates SET deleted_at = now() WHERE id = $1 AND deleted_at IS NULL RETURNING id',
        [id],
      );
      if (rows.length === 0) return false;
      await tx.query(AUDIT_SQL, [actorId, 'delete', id, ip || null, 'success']);
      return true;
    });
  }

  // EN: a stand-alone audit row, used to record DENIED attempts (result = denied).
  // Franco: satr audit lewa7do, bnesta3melo 3ashan nesagel el mo7awalat el marfooda (result = denied).
  function audit(actorId, action, certificateId, ip, result) {
    return db.query(AUDIT_SQL, [actorId, action, certificateId, ip || null, result]);
  }

  return { insertCertificate, listByEmployee, findById, listByEmployees, openFlags, updateIfPending, decide, softDelete, audit };
}

module.exports = { createRepo, CERTIFICATE_COLUMNS };
