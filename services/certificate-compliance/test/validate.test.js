// EN: unit tests: form fields and the validity calculation.
// Franco: unit tests: el fields bta3et el form w 7esab el validity.
const test = require('node:test');
const assert = require('node:assert');
const { validateUpload, isRealDate } = require('../src/validate');
const { validityOf } = require('../src/certificate');
const { GOOD_FIELDS } = require('../test-support/helpers');

test('validateUpload: good fields are returned trimmed, certificateNumber is optional', () => {
  const clean = validateUpload({ ...GOOD_FIELDS, title: '  Fire Safety  ', certificateNumber: '' });
  assert.strictEqual(clean.title, 'Fire Safety');
  assert.strictEqual(clean.certificateNumber, null);
});

test('validateUpload: employeeId in the form is ignored (the owner comes from the token)', () => {
  const clean = validateUpload({ ...GOOD_FIELDS, employeeId: '20000000-0000-4000-8000-000000000003' });
  assert.strictEqual('employeeId' in clean, false);
});

test('validateUpload: lists every problem', () => {
  assert.throws(() => validateUpload({}), (err) => err.status === 400 && err.details.length >= 5);
});

test('isRealDate: rejects 2026-02-30, accepts 2028-02-29', () => {
  assert.strictEqual(isRealDate('2026-02-30'), false);
  assert.strictEqual(isRealDate('2028-02-29'), true);
  assert.strictEqual(isRealDate('18/09/2026'), false);
});

test('validityOf: 31 days = Valid, 30 days = Expiring soon, today = Expiring soon, yesterday = Expired', () => {
  assert.strictEqual(validityOf('2026-12-24', '2026-11-23'), 'Valid');
  assert.strictEqual(validityOf('2026-12-23', '2026-11-23'), 'Expiring soon');
  assert.strictEqual(validityOf('2026-11-23', '2026-11-23'), 'Expiring soon');
  assert.strictEqual(validityOf('2026-11-22', '2026-11-23'), 'Expired');
});

test('validateDecision: verify needs no reason; reject needs 1-500 characters', () => {
  const { validateDecision } = require('../src/validate');
  assert.deepStrictEqual(validateDecision({ decision: 'verify', reason: 'ignored' }), { decision: 'verify', reason: null });
  assert.deepStrictEqual(validateDecision({ decision: 'reject', reason: ' bad scan ' }), { decision: 'reject', reason: 'bad scan' });
  assert.throws(() => validateDecision({ decision: 'reject' }), (e) => e.status === 400);
  assert.throws(() => validateDecision({ decision: 'maybe' }), (e) => e.status === 400);
  assert.throws(() => validateDecision(undefined), (e) => e.status === 400);
});
