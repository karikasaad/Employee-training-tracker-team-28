// EN: The compliance RULES of Service 2 in one pure function (no database, no network), so every rule can be
//     tested and explained on its own. Business rules (docs/API_CONTRACT.md section 8):
//     - only VERIFIED certificates count (Pending and Rejected never make anyone compliant);
//     - for every COMPLETED training that requires a certificate:
//         a Verified certificate that has not expired  -> fine, no flag;
//         Verified certificates exist but all expired  -> flag "Expired" (points to the newest one);
//         no Verified certificate at all               -> flag "Missing" (no certificate to point to).
// Franco: Rules el compliance bta3et Service 2 fe function wa7da nadeefa (mafeesh database wala network), f
//     kol rule yenfa3 yet-test w yet-sharah le wa7do. El rules:
//     - el certificates el VERIFIED bas betet7seb (Pending w Rejected 3omrohom ma yeb2o compliant);
//     - le kol training COMPLETED beyeTlob certificate:
//         certificate Verified lessa mesh expired      -> tamam, mafeesh flag;
//         fe Verified bas kolohom expired              -> flag "Expired" (beyshawer 3ala a7dasthom);
//         mafeesh Verified khalas                      -> flag "Missing" (mafeesh certificate neshawer 3aleih).
'use strict';
const { validityOf } = require('./certificate');

const iso = (value) => (value instanceof Date ? value.toISOString() : value);

// EN: Builds the answer of GET /api/compliance/teams/{teamId} (contract 5.9).
//     employees   = the team's employees from S1.
//     certRows    = their certificates (database rows, not deleted).
//     assignments = the team's COMPLETED assignments from S1 (each has requiresCertificate).
//     openFlagRows= flags already open in our table: used only to keep the real "raisedAt" time.
//     today       = "YYYY-MM-DD" (UTC); nowIso = time used as raisedAt for a flag we see for the first time.
// Franco: Beyebny rad GET /api/compliance/teams/{teamId} (contract 5.9).
//     employees = mowazzafeen el team men S1. certRows = certificates bta3thom. assignments = el assignments
//     el COMPLETED bta3et el team men S1. openFlagRows = flags maftoo7a 3andena: bnesta3melha 3ashan nekhalli
//     "raisedAt" el 7a2i2i. today = tareekh UTC; nowIso = el wa2t elly bnesta3melo ka raisedAt law awel mara nshoof el flag.
function buildTeamCompliance({ teamId, employees, certRows, assignments, openFlagRows = [], today, nowIso }) {
  const raisedAtOf = new Map(openFlagRows.map((f) => [`${f.employee_id}|${f.training_id}|${f.flag_type}`, iso(f.raised_at)]));

  return {
    teamId,
    employees: employees.map((employee) => {
      const mine = certRows.filter((c) => c.employee_id === employee.id);

      // EN: every certificate of this employee (all statuses; the reader decides what counts).
      // Franco: kol certificates el mowazzaf (kol el status; el reader hwa elly yeqarrar eh elly beyet7seb).
      const certificates = mine.map((c) => ({
        certificateId: c.id,
        trainingId: c.training_id,
        reviewStatus: c.review_status,
        expiryDate: c.expiry_date,
        validity: validityOf(c.expiry_date, today),
      }));

      // EN: trainings this employee completed and that need a certificate (each training once).
      // Franco: el trainings elly el mowazzaf khallasha w me7taga certificate (kol training mara wa7da).
      const needed = [...new Set(assignments
        .filter((a) => a.employeeId === employee.id && a.requiresCertificate === true)
        .map((a) => a.trainingId))];

      const flags = [];
      for (const trainingId of needed) {
        const verified = mine.filter((c) => c.training_id === trainingId && c.review_status === 'Verified');
        // EN: "YYYY-MM-DD" strings compare correctly as text. Expiring today is NOT expired yet.
        // Franco: el tawareekh "YYYY-MM-DD" betet-qaren sa7 ka nass. Law bey-entehy el naharda lessa mesh expired.
        if (verified.some((c) => c.expiry_date >= today)) continue;

        const newest = verified.reduce((best, c) => (!best || c.expiry_date > best.expiry_date ? c : best), null);
        const flagType = newest ? 'Expired' : 'Missing';
        flags.push({
          flagType,
          trainingId,
          certificateId: newest ? newest.id : null,
          raisedAt: raisedAtOf.get(`${employee.id}|${trainingId}|${flagType}`) || nowIso,
        });
      }
      return { employeeId: employee.id, certificates, flags };
    }),
  };
}

module.exports = { buildTeamCompliance };
