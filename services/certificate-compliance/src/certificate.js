// EN: Turns a database row into the JSON the API returns (docs/API_CONTRACT.md "Certificate"), and
//     calculates "validity" from the expiry date. s3Key and fileHash are NEVER returned.
// Franco: Bey7awwel satr el database le JSON elly el API beyrga3o, w beye7seb "validity" men tareekh
//     el entehaa. s3Key w fileHash 3omrohom ma byerga3o.
'use strict';

// EN: Valid = more than 30 days left. Expiring soon = 0 to 30 days. Expired = the date has passed.
//     Both dates are YYYY-MM-DD in UTC, so the difference is a whole number of days.
// Franco: Valid = ba2y aktar men 30 yom. Expiring soon = men 0 le 30 yom. Expired = el tareekh fat.
//     el tarkheen UTC, f el far2 3adad sa7eeh men el ayam.
function validityOf(expiryDate, today) {
  const days = Math.round((Date.parse(`${expiryDate}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
  if (days < 0) return 'Expired';
  if (days <= 30) return 'Expiring soon';
  return 'Valid';
}

function iso(value) {
  return value instanceof Date ? value.toISOString() : value;
}

function toCertificate(row, today) {
  return {
    id: row.id,
    employeeId: row.employee_id,
    trainingId: row.training_id,
    title: row.title,
    issuer: row.issuer,
    certificateNumber: row.certificate_number,
    issueDate: row.issue_date,
    expiryDate: row.expiry_date,
    reviewStatus: row.review_status,
    validity: validityOf(row.expiry_date, today),
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
    uploadedAt: iso(row.uploaded_at),
    verifiedBy: row.verified_by,
    verifiedAt: iso(row.verified_at),
    rejectReason: row.reject_reason,
  };
}

module.exports = { validityOf, toCertificate };
