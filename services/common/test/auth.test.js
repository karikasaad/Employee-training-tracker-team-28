// EN: Tests for auth.js with locally generated RSA keys (no Cognito needed). They prove that forged,
//     expired, tampered and wrong-audience tokens are rejected: evidence for the "stolen / forged token"
//     threat. Run: node --test (inside services/common).
// Franco: Tests le auth.js b RSA keys ma3mola local (mesh me7tageen Cognito). Betethbet en el tokens el
//     mozawwara w el expired w el metghayyara w bta3et app tany betetrefed: dalil 3ala threat el token
//     el masroo2 / el mozawwar.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { createAuth, createJwksCache, AuthError } = require('../auth');

const ISSUER = 'http://localhost:4566/us-east-1_TESTPOOL';
const WEB_CLIENT = 'web-client-123';
const SERVICE_CLIENT = 'service-client-456';
const NOW = 1_800_000_000;

// EN: one "real" key pair (plays Cognito) and one attacker key pair.
// Franco: key pair "7a2i2i" (bey-mattel Cognito) w key pair tany lel attacker.
const good = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const evil = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const goodJwk = { ...good.publicKey.export({ format: 'jwk' }), kid: 'kid-1', alg: 'RS256', use: 'sig' };

const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
function sign(payload, { key = good.privateKey, header = { alg: 'RS256', kid: 'kid-1', typ: 'JWT' } } = {}) {
  const head = `${b64(header)}.${b64(payload)}`;
  return `${head}.${crypto.sign('RSA-SHA256', Buffer.from(head), key).toString('base64url')}`;
}
function claims(extra = {}) {
  return { sub: 'sub-ahmed', iss: ISSUER, token_use: 'access', client_id: WEB_CLIENT,
    'cognito:groups': ['Employee'], iat: NOW - 60, exp: NOW + 840, username: 'ahmed@example.com', ...extra };
}

const auth = createAuth({
  issuer: ISSUER, webClientIds: [WEB_CLIENT], serviceClientId: SERVICE_CLIENT,
  getKey: async (kid) => (kid === 'kid-1' ? goodJwk : undefined),
  nowSec: () => NOW,
});

async function expect401(token, why) {
  await assert.rejects(auth.verifyToken(token), (err) => {
    assert.ok(err instanceof AuthError, 'should be an AuthError');
    assert.equal(err.status, 401);
    if (why) assert.match(err.message, why);
    return true;
  });
}

// ---------------------------------------------------------------- verifyToken
test('valid access token is accepted and returns sub + roles', async () => {
  const user = await auth.verifyToken(sign(claims()));
  assert.equal(user.sub, 'sub-ahmed');
  assert.deepEqual(user.roles, ['Employee']);
  assert.equal(user.isService, false);
});

test('expired token -> 401', () => expect401(sign(claims({ exp: NOW - 10 })), /expired/));

test('tampered payload (Employee changes group to Manager) -> 401', async () => {
  const [h, , s] = sign(claims()).split('.');
  await expect401(`${h}.${b64(claims({ 'cognito:groups': ['Manager'] }))}.${s}`, /signature/);
});

test('token signed by an attacker key with our kid (forged) -> 401', () =>
  expect401(sign(claims(), { key: evil.privateKey }), /signature/));

test('wrong issuer (another user pool) -> 401', () =>
  expect401(sign(claims({ iss: 'http://localhost:4566/us-east-1_OTHER' })), /issuer/));

test('wrong audience (token issued to another app client) -> 401', () =>
  expect401(sign(claims({ client_id: 'someone-elses-app' })), /another application/));

test('wrong token_use (ID token sent instead of access token) -> 401', () =>
  expect401(sign(claims({ token_use: 'id' })), /access token/));

test('alg "none" (unsigned token) -> 401', () => {
  const head = `${b64({ alg: 'none', kid: 'kid-1' })}.${b64(claims())}`;
  return expect401(`${head}.`, /./);
});

test('HS256 algorithm-confusion token -> 401', () => {
  const pem = good.publicKey.export({ format: 'pem', type: 'spki' });
  const head = `${b64({ alg: 'HS256', kid: 'kid-1' })}.${b64(claims())}`;
  const mac = crypto.createHmac('sha256', pem).update(head).digest('base64url');
  return expect401(`${head}.${mac}`, /algorithm/);
});

test('unknown key id -> 401', () =>
  expect401(sign(claims(), { header: { alg: 'RS256', kid: 'kid-unknown' } }), /Unknown signing key/));

test('garbage and empty tokens -> 401', async () => {
  await expect401('not-a-jwt', /Malformed/);
  await expect401('', /Malformed/);
  await expect401('a.b.c', /Malformed/);
});

test('token issued in the future -> 401', () =>
  expect401(sign(claims({ iat: NOW + 3600, exp: NOW + 7200 })), /future/));

test('groups other than Employee/Manager are ignored (no made-up roles)', async () => {
  const user = await auth.verifyToken(sign(claims({ 'cognito:groups': ['Admin', 'Employee'] })));
  assert.deepEqual(user.roles, ['Employee']);
});

test('service client token gets only the Service role', async () => {
  const user = await auth.verifyToken(sign(claims({ client_id: SERVICE_CLIENT, 'cognito:groups': ['Manager'], sub: 'svc' })));
  assert.deepEqual(user.roles, ['Service']);
  assert.equal(user.isService, true);
});

test('JWKS unreachable -> fails closed with 401', async () => {
  const down = createAuth({ issuer: ISSUER, webClientIds: [WEB_CLIENT], nowSec: () => NOW,
    getKey: async () => { throw new Error('ECONNREFUSED'); } });
  await assert.rejects(down.verifyToken(sign(claims())), (e) => e.status === 401);
});

// ---------------------------------------------------------------- requireAuth middleware
function run(middleware, authorization) {
  return new Promise((resolve) => {
    const req = { headers: authorization === undefined ? {} : { authorization } };
    middleware(req, {}, (err) => resolve({ err, req }));
  });
}

test('middleware: no Authorization header -> 401', async () => {
  const { err } = await run(auth.requireAuth(), undefined);
  assert.equal(err.status, 401);
  assert.equal(err.code, 'UNAUTHENTICATED');
});

test('middleware: "Basic" or extra text instead of a Bearer token -> 401', async () => {
  assert.equal((await run(auth.requireAuth(), 'Basic dXNlcjpwYXNz')).err.status, 401);
  assert.equal((await run(auth.requireAuth(), `Bearer ${sign(claims())} extra`)).err.status, 401);
});

test('middleware: Employee token on a Manager-only route -> 403', async () => {
  const { err } = await run(auth.requireAuth(['Manager']), `Bearer ${sign(claims())}`);
  assert.equal(err.status, 403);
  assert.equal(err.code, 'FORBIDDEN');
});

test('middleware: Manager token on a Manager-only route -> next() with req.user', async () => {
  const { err, req } = await run(auth.requireAuth(['Manager']), `Bearer ${sign(claims({ 'cognito:groups': ['Manager'] }))}`);
  assert.equal(err, undefined);
  assert.deepEqual(req.user.roles, ['Manager']);
});

test('middleware: Service token on a person-only route -> 403; on a Service route -> allowed', async () => {
  const token = `Bearer ${sign(claims({ client_id: SERVICE_CLIENT, 'cognito:groups': [] }))}`;
  assert.equal((await run(auth.requireAuth(['Employee', 'Manager']), token)).err.status, 403);
  assert.equal((await run(auth.requireAuth(['Service']), token)).err, undefined);
});

test('middleware: resolveEmployeeId hook adds employeeId for people', async () => {
  const s1 = createAuth({ issuer: ISSUER, webClientIds: [WEB_CLIENT], nowSec: () => NOW,
    getKey: async () => goodJwk, resolveEmployeeId: async (sub) => `emp-of-${sub}` });
  const { req } = await run(s1.requireAuth(), `Bearer ${sign(claims())}`);
  assert.equal(req.user.employeeId, 'emp-of-sub-ahmed');
});

test('createAuth refuses to start without issuer / client id (fail fast)', () => {
  assert.throws(() => createAuth({ env: {} }), /COGNITO_ISSUER/);
});

// ---------------------------------------------------------------- JWKS cache
test('JWKS cache: fetches once, and an unknown kid refreshes at most once a minute', async () => {
  let calls = 0;
  let clock = 0;
  const fetchImpl = async () => { calls += 1; return { ok: true, json: async () => ({ keys: [goodJwk] }) }; };
  const getKey = createJwksCache({ jwksUrl: 'http://jwks', fetchImpl, now: () => clock });
  clock = 10_000_000;
  assert.equal((await getKey('kid-1')).kid, 'kid-1');
  await getKey('kid-1');
  await getKey('fake-1');
  await getKey('fake-2');
  assert.equal(calls, 1, 'fake kids within a minute must not refetch');
  clock += 61_000;
  await getKey('fake-3');
  assert.equal(calls, 2);
});
