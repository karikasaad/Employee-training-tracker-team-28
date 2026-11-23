// EN: Business rules of Service 1 as small PURE functions (no database, no HTTP), so they are easy to
//     test and to explain. Dates are plain "YYYY-MM-DD" strings in UTC.
// Franco: Rules el business bta3et Service 1 ka functions so8ayyara PURE (mafeesh database wala HTTP),
//     3ashan tetest w tetshare7 bsohoola. El tawareekh strings "YYYY-MM-DD" bel UTC.
'use strict';

const DAY_MS = 24 * 60 * 60 * 1000;

// EN: today's date in UTC as "YYYY-MM-DD" (the contract says "today" is always the UTC date).
// Franco: tareekh el naharda bel UTC ka "YYYY-MM-DD" (el contract beye2ool "today" dayman bel UTC).
function todayUtc(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

// EN: true only for a real calendar date written as YYYY-MM-DD (2026-02-30 and 2026-1-5 are refused).
// Franco: true bas law tareekh 7a2i2i maktoob YYYY-MM-DD (2026-02-30 w 2026-1-5 marfoodeen).
function isValidDate(text) {
  if (typeof text !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const d = new Date(`${text}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === text;
}

// EN: RULE "status" (calculated on read, never stored):
//       completed (even late)                -> Completed
//       not completed and dueDate < today    -> Overdue
//       otherwise (due today or later)       -> Assigned   (due TODAY is NOT overdue)
//     "YYYY-MM-DD" strings compare correctly with < because the format is fixed.
// Franco: RULE el "status" (bet-et7seb wa2t el qeraya, mesh mat-khazzan):
//       khelset (7atta law met2akhar)        -> Completed
//       makhelsetsh w dueDate < el naharda   -> Overdue
//       gheir kda (ma3adha el naharda aw ba3d) -> Assigned  (ma3adha EL NAHARDA mesh overdue)
function calculateStatus(dueDate, completedAt, today) {
  if (completedAt) return 'Completed';
  if (dueDate < today) return 'Overdue';
  return 'Assigned';
}

// EN: how many days late an Overdue assignment is; 0 for any other status.
// Franco: kam yom met2akhar el assignment el Overdue; 0 le ay status tany.
function daysOverdue(dueDate, completedAt, today) {
  if (calculateStatus(dueDate, completedAt, today) !== 'Overdue') return 0;
  return Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${dueDate}T00:00:00Z`)) / DAY_MS);
}

// EN: RULE "renewal date": completed date (UTC) + validityMonths. If that day does not exist in the target
//     month it moves to the month's last day: Jan 31 + 1 month = Feb 28 (or Feb 29 in a leap year).
// Franco: RULE "tareekh el renewal": tareekh el khelsan (UTC) + validityMonths. Law el yom mesh mawgood fel
//     shahr el gai beyro7 le akher yom feeh: 31 Jan + shahr = 28 Feb (aw 29 fel sana el kabeesa).
function nextDueDate(completedAt, validityMonths) {
  const done = new Date(completedAt);
  const year = done.getUTCFullYear();
  const month = done.getUTCMonth() + validityMonths;
  const lastDayOfTarget = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const day = Math.min(done.getUTCDate(), lastDayOfTarget);
  return new Date(Date.UTC(year, month, day)).toISOString().slice(0, 10);
}

module.exports = { todayUtc, isValidDate, calculateStatus, daysOverdue, nextDueDate };
