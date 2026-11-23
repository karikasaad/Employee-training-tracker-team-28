// EN: Table-driven unit tests for src/rules.js (no database). Each row = one case we can read out loud in
//     the discussion: input -> expected result.
// Franco: Unit tests table-driven le src/rules.js (mafeesh database). Kol satr = case wa7da n2dar ne2raha
//     fel discussion: el input -> el natiga el motawaqqa3a.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { todayUtc, isValidDate, calculateStatus, daysOverdue, nextDueDate } = require('../src/rules');

const TODAY = '2026-11-23';

test('calculateStatus: Overdue / Assigned / Completed', () => {
  const cases = [
    // dueDate,      completedAt,               expected
    ['2026-11-22', null, 'Overdue'], // EN: due yesterday, not done / Franco: ma3ado embare7 w makhelsetsh
    ['2026-11-23', null, 'Assigned'], // EN: due TODAY is not overdue / Franco: ma3ado el naharda mesh overdue
    ['2026-12-31', null, 'Assigned'], // EN: future / Franco: fel mosta2bal
    ['2026-01-01', null, 'Overdue'], // EN: long ago / Franco: men zaman
    ['2026-11-10', '2026-11-20T09:00:00.000Z', 'Completed'], // EN: completed LATE is still Completed
    ['2026-11-30', '2026-11-20T09:00:00.000Z', 'Completed'], // EN: completed early
  ];
  for (const [due, done, expected] of cases) {
    assert.equal(calculateStatus(due, done, TODAY), expected, `${due} / ${done}`);
  }
});

test('daysOverdue: days late for Overdue, 0 otherwise', () => {
  assert.equal(daysOverdue('2026-11-22', null, TODAY), 1);
  assert.equal(daysOverdue('2026-11-13', null, TODAY), 10);
  assert.equal(daysOverdue('2025-11-23', null, TODAY), 365);
  assert.equal(daysOverdue('2026-11-23', null, TODAY), 0);
  assert.equal(daysOverdue('2026-11-01', '2026-11-20T09:00:00Z', TODAY), 0);
});

test('nextDueDate: completed date + validityMonths, clamped to the month end', () => {
  const cases = [
    ['2026-11-23T09:00:00.000Z', 12, '2027-11-23'],
    ['2026-01-31T10:00:00.000Z', 1, '2026-02-28'], // EN: Jan 31 + 1 month, not a leap year
    ['2028-01-31T10:00:00.000Z', 1, '2028-02-29'], // EN: leap year / Franco: sana kabeesa
    ['2026-08-31T10:00:00.000Z', 6, '2027-02-28'],
    ['2026-03-31T10:00:00.000Z', 1, '2026-04-30'],
    ['2026-12-15T10:00:00.000Z', 1, '2027-01-15'], // EN: year rollover / Franco: sana gdeeda
    ['2026-05-10T23:30:00.000Z', 24, '2028-05-10'], // EN: late in the UTC day stays the same UTC date
    ['2026-02-28T10:00:00.000Z', 120, '2036-02-28'],
  ];
  for (const [done, months, expected] of cases) {
    assert.equal(nextDueDate(done, months), expected, `${done} + ${months}`);
  }
});

test('isValidDate: only real YYYY-MM-DD dates', () => {
  for (const ok of ['2026-11-23', '2028-02-29', '2026-12-31']) assert.equal(isValidDate(ok), true, ok);
  for (const bad of ['2026-02-30', '2027-02-29', '2026-13-01', '2026-1-5', '23-11-2026', '2026-11-23T00:00:00Z', '', null, 20261123]) {
    assert.equal(isValidDate(bad), false, String(bad));
  }
});

test('todayUtc uses the UTC date, not the local time zone', () => {
  assert.equal(todayUtc(new Date('2026-11-23T23:30:00.000Z')), '2026-11-23');
  assert.equal(todayUtc(new Date('2026-11-24T00:10:00.000+02:00')), '2026-11-23'); // EN: Cairo after midnight = still 23rd in UTC
});
