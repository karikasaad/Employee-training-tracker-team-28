// EN: The 6-digit code of an authenticator app (TOTP, RFC 6238), so the spike can answer Cognito's MFA challenge
//     like a real phone app would. Pure functions, no network. Used only by cognito_spike.js and its test.
// Franco: El code el 6 ar2am bta3 app el authenticator (TOTP, RFC 6238), 3ashan el spike yerod 3ala MFA challenge
//     bta3 Cognito zay mobile app 7a2i2i. Functions nazeefa, mafeesh network. Bet-estakhdem fe cognito_spike.js bas.
'use strict';
const crypto = require('node:crypto');

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

// EN: Cognito gives the secret as base32 text; turn it into bytes.
// Franco: Cognito beyedy el secret ka text base32; benhawwelo le bytes.
function base32Decode(text) {
  const clean = String(text).toUpperCase().replace(/=+$/, '').replace(/\s+/g, '');
  let bits = '';
  for (const ch of clean) {
    const value = ALPHABET.indexOf(ch);
    if (value < 0) throw new Error('not a base32 secret');
    bits += value.toString(2).padStart(5, '0');
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}

// EN: code = last 31 bits of HMAC-SHA1(secret, 30-second counter), cut to `digits` digits.
// Franco: el code = akher 31 bit men HMAC-SHA1(secret, 3adad kol 30 sanya), maqtoo3 le `digits` ar2am.
function totp(base32Secret, nowMs = Date.now(), digits = 6, stepSeconds = 30) {
  const counter = Math.floor(nowMs / 1000 / stepSeconds);
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const hmac = crypto.createHmac('sha1', base32Decode(base32Secret)).update(message).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary = hmac.readUInt32BE(offset) & 0x7fffffff;
  return String(binary % 10 ** digits).padStart(digits, '0');
}

module.exports = { base32Decode, totp };
