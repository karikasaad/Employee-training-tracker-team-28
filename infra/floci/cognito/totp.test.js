// EN: Tests for totp.js with the official RFC 6238 test values (SHA-1 secret "12345678901234567890").
//     Run: node --test infra/floci/cognito/totp.test.js
// Franco: Tests le totp.js b el values el rasmiyya men RFC 6238 (secret SHA-1 "12345678901234567890").
//     Shaghalha: node --test infra/floci/cognito/totp.test.js
const test = require('node:test');
const assert = require('node:assert');
const { base32Decode, totp } = require('./totp');

const SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'; // EN: base32 of the ASCII text 12345678901234567890

test('base32Decode gives the RFC secret bytes', () => {
  assert.strictEqual(base32Decode(SECRET).toString('ascii'), '12345678901234567890');
  assert.strictEqual(base32Decode(`${SECRET.toLowerCase()}====`).toString('ascii'), '12345678901234567890');
});

test('base32Decode refuses text that is not base32', () => {
  assert.throws(() => base32Decode('abc!def'), /base32/);
});

test('totp matches the RFC 6238 vectors (8 digits)', () => {
  assert.strictEqual(totp(SECRET, 59 * 1000, 8), '94287082');
  assert.strictEqual(totp(SECRET, 1111111109 * 1000, 8), '07081804');
  assert.strictEqual(totp(SECRET, 1234567890 * 1000, 8), '89005924');
  assert.strictEqual(totp(SECRET, 20000000000 * 1000, 8), '65353130');
});

test('totp gives 6 digits by default and the same code inside one 30-second step', () => {
  assert.strictEqual(totp(SECRET, 59 * 1000), '287082');
  assert.strictEqual(totp(SECRET, 30 * 1000), totp(SECRET, 59 * 1000));
  assert.notStrictEqual(totp(SECRET, 59 * 1000), totp(SECRET, 60 * 1000));
});
