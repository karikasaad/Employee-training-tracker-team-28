// EN: All SQL of Service 2 lives here. Every value is a $n parameter (services/common/db.js refuses
//     quotes in SQL text), so SQL injection is not possible. S2 connects as the role svc_s2.
// Franco: Kol SQL bta3 Service 2 hena. Kol value $n parameter (services/common/db.js bey-refod el quotes
//     fel SQL), f SQL injection mesh momken. S2 beydkhol bel role svc_s2.
'use strict';

const CERTIFICATE_COLUMNS = `id, employee_id, training_id, title, issuer, certificate_number,
  issue_date::text AS issue_date, expiry_date::text AS expiry_date, review_status, mime_type, size_bytes,
  uploaded_at, verified_by, verified_at, reject_reason`;

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
      await tx.query(
        `INSERT INTO audit_log (actor_id, action, certificate_id, ip_address, result)
         VALUES ($1, $2, $3, $4, $5)`,
        [c.employeeId, 'upload', row.id, ip || null, 'success'],
      );
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

  return { insertCertificate, listByEmployee };
}

module.exports = { createRepo, CERTIFICATE_COLUMNS };
