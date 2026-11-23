// EN: Checks the text fields of the upload form. Every rule matches the database (schema.sql), so a bad
//     value is answered with a clear 400 here instead of a database error later.
// Franco: Bey-check el fields el nasseya bta3et el form. Kol rule zay el database (schema.sql), f el value
//     el ghalat teb2a 400 wad7a hena badal error men el database ba3dein.
'use strict';
const { badRequest } = require('../../common/errors');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// EN: a real calendar date written YYYY-MM-DD. "2026-02-30" is rejected.
// Franco: tareekh 7a2i2i bel shakl YYYY-MM-DD. "2026-02-30" betetrefed.
function isRealDate(text) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const date = new Date(`${text}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === text;
}

// EN: validates the form fields and returns clean values. Throws 400 with the list of problems.
//     employeeId is NOT read here: the owner of the certificate always comes from the token.
// Franco: bey-validate el fields w beyrga3 values nadeefa. Beyrmy 400 m3a lestet el moshkelat.
//     employeeId mabnoo2raash hena: sa7eb el certificate dayman gai men el token.
function validateUpload(body) {
  const problems = [];
  const text = (field, min, max, required) => {
    const raw = body[field];
    if (raw === undefined || raw === null || raw === '') {
      if (required) problems.push({ field, issue: 'is required' });
      return null;
    }
    if (typeof raw !== 'string') { problems.push({ field, issue: 'must be text' }); return null; }
    const value = raw.trim();
    if (value.length < min || value.length > max) { problems.push({ field, issue: `must be ${min}-${max} characters` }); return null; }
    return value;
  };
  const date = (field) => {
    const raw = typeof body[field] === 'string' ? body[field].trim() : '';
    if (!raw) { problems.push({ field, issue: 'is required' }); return null; }
    if (!isRealDate(raw)) { problems.push({ field, issue: 'must be a real date as YYYY-MM-DD' }); return null; }
    return raw;
  };

  const trainingId = text('trainingId', 1, 36, true);
  if (trainingId && !UUID.test(trainingId)) problems.push({ field: 'trainingId', issue: 'must be a UUID' });
  const title = text('title', 1, 150, true);
  const issuer = text('issuer', 1, 150, true);
  const certificateNumber = text('certificateNumber', 1, 100, false);
  const issueDate = date('issueDate');
  const expiryDate = date('expiryDate');
  // EN: business rule: a certificate cannot be issued after it expires (same CHECK as the database).
  // Franco: rule: el certificate mayenfa3sh yeb2a issued ba3d ma yentehy (nafs el CHECK fel database).
  if (issueDate && expiryDate && issueDate > expiryDate) problems.push({ field: 'issueDate', issue: 'must not be after expiryDate' });

  if (problems.length > 0) throw badRequest('The certificate data is not valid', problems);
  return { trainingId: trainingId.toLowerCase(), title, issuer, certificateNumber, issueDate, expiryDate };
}

module.exports = { validateUpload, isRealDate };
