// EN: Tests for db.js (SQL-injection guard rails, transactions), logging.js (secrets are redacted) and
//     errors.js (one JSON error format, no stack traces leak). Run: node --test (in services/common).
// Franco: Tests le db.js (qawa3ed aman el SQL injection, el transactions), logging.js (el secrets
//     betetkhabba) w errors.js (format wa7ed lel errors, mafeesh stack trace beyetsarrab).
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createDb, assertSafeQuery, poolConfigFromEnv, UnsafeQueryError } = require('../db');
const { createLogger, redact, requestIdMiddleware, requestLogger, REDACTED } = require('../logging');
const errors = require('../errors');

// ================================================================= db.js
test('db: parameterised query passes the guard', () => {
  assert.doesNotThrow(() => assertSafeQuery('SELECT * FROM trainings WHERE category = $1 AND id = $2', ['Safety', 'x']));
  assert.doesNotThrow(() => assertSafeQuery('SELECT now()', []));
});

test('db: SQL built by string concatenation (quotes in the text) is refused', () => {
  const category = "Safety' OR '1'='1";
  assert.throws(() => assertSafeQuery(`SELECT * FROM trainings WHERE category = '${category}'`, []), UnsafeQueryError);
});

test('db: stacked queries are refused', () => {
  assert.throws(() => assertSafeQuery('SELECT 1; DROP TABLE employees', []), /one SQL statement/);
  assert.doesNotThrow(() => assertSafeQuery('SELECT 1;', []));
});

test('db: placeholder count must match the params', () => {
  assert.throws(() => assertSafeQuery('SELECT * FROM t WHERE a = $1 AND b = $2', ['only-one']), /\$1..\$2/);
  assert.throws(() => assertSafeQuery('SELECT * FROM t', ['extra']), UnsafeQueryError);
  assert.throws(() => assertSafeQuery('SELECT 1', 'not-an-array'), /array/);
});

test('db: an injection string stays a harmless parameter value', async () => {
  const seen = [];
  const db = createDb({ pool: { query: async (sql, params) => { seen.push({ sql, params }); return { rows: [] }; } } });
  const evil = "x'; DROP TABLE employees; --";
  assert.deepEqual(await db.query('SELECT id FROM trainings WHERE category = $1', [evil]), []);
  assert.equal(seen[0].sql, 'SELECT id FROM trainings WHERE category = $1');
  assert.deepEqual(seen[0].params, [evil]);
});

function fakeTxPool() {
  const log = [];
  const client = { query: async (sql) => { log.push(sql); if (sql.startsWith('FAIL')) throw new Error('boom'); return { rows: [{ ok: 1 }] }; },
    release: () => log.push('RELEASE') };
  return { log, pool: { query: async () => ({ rows: [] }), connect: async () => client } };
}

test('db: withTransaction commits when the work succeeds', async () => {
  const { log, pool } = fakeTxPool();
  const result = await createDb({ pool }).withTransaction(async (tx) => tx.queryOne('SELECT 1', []));
  assert.deepEqual(result, { ok: 1 });
  assert.deepEqual(log, ['BEGIN', 'SELECT 1', 'COMMIT', 'RELEASE']);
});

test('db: withTransaction rolls back on error (all or nothing)', async () => {
  const { log, pool } = fakeTxPool();
  await assert.rejects(createDb({ pool }).withTransaction(async (tx) => { await tx.query('SELECT 1', []); await tx.query('FAIL now', []); }), /boom/);
  assert.deepEqual(log, ['BEGIN', 'SELECT 1', 'FAIL now', 'ROLLBACK', 'RELEASE']);
});

test('db: unsafe SQL inside a transaction is refused and rolled back', async () => {
  const { log, pool } = fakeTxPool();
  await assert.rejects(createDb({ pool }).withTransaction(async (tx) => tx.query("SELECT 'x'", [])), UnsafeQueryError);
  assert.ok(log.includes('ROLLBACK'));
});

test('db: config comes from the environment and fails fast when a value is missing', () => {
  assert.throws(() => poolConfigFromEnv({ DB_HOST: 'postgres' }), /DB_NAME, DB_USER, DB_PASSWORD/);
  const cfg = poolConfigFromEnv({ DB_HOST: 'postgres', DB_NAME: 'training', DB_USER: 'svc_s1', DB_PASSWORD: 'x' });
  assert.equal(cfg.user, 'svc_s1');
  assert.equal(cfg.ssl, false);
  assert.equal(poolConfigFromEnv({ DB_HOST: 'h', DB_NAME: 'n', DB_USER: 'u', DB_PASSWORD: 'p', DB_SSL: 'true' }).ssl.rejectUnauthorized, true);
});

// ================================================================= logging.js
const FAKE_JWT = 'eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJhYmMxMjMifQ.c2lnbmF0dXJlLXBhcnQ';

test('logging: secret keys are redacted at any depth', () => {
  const out = redact({ authorization: 'Bearer abc', user: { password: 'P@ss', accessToken: 'x', name: 'Ahmed' },
    headers: { Cookie: 'sid=1', 'x-api-key': 'k' }, clientSecret: 's', list: [{ refresh_token: 'r' }] });
  assert.equal(out.authorization, REDACTED);
  assert.equal(out.user.password, REDACTED);
  assert.equal(out.user.accessToken, REDACTED);
  assert.equal(out.user.name, 'Ahmed');
  assert.equal(out.headers.Cookie, REDACTED);
  assert.equal(out.headers['x-api-key'], REDACTED);
  assert.equal(out.clientSecret, REDACTED);
  assert.equal(out.list[0].refresh_token, REDACTED);
});

test('logging: a JWT or Bearer value hidden inside free text is redacted', () => {
  const msg = redact(`upstream said: invalid ${FAKE_JWT} for Bearer ${FAKE_JWT} and Basic dXNlcjpwYXNz`);
  assert.ok(!msg.includes('eyJhbGci'), msg);
  assert.ok(!msg.includes('dXNlcjpwYXNz'), msg);
});

test('logging: a written log line never contains a token, password or Authorization header', () => {
  const lines = [];
  const logger = createLogger('employee-training', { write: (l) => lines.push(l) });
  logger.warn('auth_failure', { path: '/api/assignments/me', authorization: `Bearer ${FAKE_JWT}`, password: 'Test@12345678',
    note: `token was ${FAKE_JWT}` });
  const line = lines[0];
  assert.ok(!line.includes(FAKE_JWT));
  assert.ok(!line.includes('Test@12345678'));
  const parsed = JSON.parse(line);
  assert.equal(parsed.level, 'warn');
  assert.equal(parsed.service, 'employee-training');
  assert.equal(parsed.event, 'auth_failure');
  assert.ok(parsed.timestamp);
});

test('logging: level filter drops debug lines by default', () => {
  const lines = [];
  const logger = createLogger('s', { write: (l) => lines.push(l), level: 'info' });
  logger.debug('noise'); logger.info('kept');
  assert.equal(lines.length, 1);
});

function fakeRes() {
  const handlers = {};
  return { headers: {}, locals: {}, statusCode: 200,
    setHeader(k, v) { this.headers[k] = v; }, on(ev, fn) { handlers[ev] = fn; }, emit(ev) { handlers[ev](); },
    status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
}

test('logging: request id is reused when safe, replaced when not', () => {
  const res1 = fakeRes(); const req1 = { headers: { 'x-request-id': 'abc12345-req' } };
  requestIdMiddleware(req1, res1, () => {});
  assert.equal(req1.requestId, 'abc12345-req');
  const res2 = fakeRes(); const req2 = { headers: { 'x-request-id': 'bad id\n{"level":"error"}' } };
  requestIdMiddleware(req2, res2, () => {});
  assert.match(req2.requestId, /^[0-9a-f-]{36}$/);
  assert.equal(res2.headers['X-Request-Id'], req2.requestId);
});

test('logging: 403 request is logged as warn "forbidden" with path only (no query string, no headers)', () => {
  const lines = [];
  const logger = createLogger('s1', { write: (l) => lines.push(l) });
  const req = { method: 'GET', originalUrl: `/api/teams/t2/assignments?status=overdue&token=${FAKE_JWT}`,
    headers: { authorization: `Bearer ${FAKE_JWT}` }, requestId: 'r-12345678', user: { sub: 'sub-1', roles: ['Manager'] }, ip: '172.18.0.5' };
  const res = fakeRes();
  requestLogger(logger)(req, res, () => {});
  res.statusCode = 403;
  res.emit('finish');
  const entry = JSON.parse(lines[0]);
  assert.equal(entry.level, 'warn');
  assert.equal(entry.event, 'forbidden');
  assert.equal(entry.path, '/api/teams/t2/assignments');
  assert.equal(entry.userSub, 'sub-1');
  assert.ok(!lines[0].includes(FAKE_JWT));
  assert.equal(entry.authorization, undefined);
});

test('logging: 401 is logged as "auth_failure"', () => {
  const lines = [];
  const logger = createLogger('s1', { write: (l) => lines.push(l) });
  const res = fakeRes();
  requestLogger(logger)({ method: 'GET', url: '/api/employees/me', headers: {} }, res, () => {});
  res.statusCode = 401; res.emit('finish');
  assert.equal(JSON.parse(lines[0]).event, 'auth_failure');
});

// ================================================================= errors.js
function handle(err) {
  const lines = [];
  const res = fakeRes();
  errors.errorHandler(createLogger('s', { write: (l) => lines.push(l) }))(err, { requestId: 'r1' }, res, () => {});
  return { res, lines };
}

test('errors: HttpError keeps its status, code, message and details', () => {
  const { res } = handle(errors.badRequest('dueDate must be today or later', [{ field: 'dueDate', issue: 'in the past' }]));
  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.body, { error: { code: 'VALIDATION_ERROR', message: 'dueDate must be today or later',
    details: [{ field: 'dueDate', issue: 'in the past' }] } });
});

test('errors: every helper maps to the contract status code', () => {
  const cases = [[errors.unauthorized(), 401], [errors.forbidden(), 403], [errors.notFound(), 404], [errors.conflict('x'), 409],
    [errors.payloadTooLarge(), 413], [errors.unsupportedMediaType(), 415], [errors.upstreamError(), 502], [errors.upstreamUnavailable(), 503]];
  for (const [err, status] of cases) {
    const { res } = handle(err);
    assert.equal(res.statusCode, status);
    assert.equal(res.body.error.code, errors.CODES[status]);
  }
});

test('errors: auth errors (status 401/403 + code, as thrown by auth.js) become 401 / 403 JSON', () => {
  // EN: same shape as AuthError in auth.js, built here so this file does not depend on it.
  // Franco: nafs shakl AuthError fe auth.js, ma3mool hena 3ashan el file da mayetla2ash 3aleih.
  const authError = (status, code, message) => Object.assign(new Error(message), { status, code });
  assert.equal(handle(authError(401, 'UNAUTHENTICATED', 'Token expired')).res.body.error.code, 'UNAUTHENTICATED');
  assert.equal(handle(authError(403, 'FORBIDDEN', 'Wrong role')).res.statusCode, 403);
});

test('errors: express.json body errors -> 413 / 400', () => {
  assert.equal(handle(Object.assign(new Error('too big'), { type: 'entity.too.large' })).res.statusCode, 413);
  assert.equal(handle(Object.assign(new Error('bad json'), { type: 'entity.parse.failed' })).res.statusCode, 400);
});

test('errors: database errors -> 409 duplicate, 400 bad id', () => {
  assert.equal(handle(Object.assign(new Error('dup'), { code: '23505' })).res.statusCode, 409);
  assert.equal(handle(Object.assign(new Error('bad uuid'), { code: '22P02' })).res.statusCode, 400);
});

test('errors: unexpected error -> generic 500, details only in the log', () => {
  const { res, lines } = handle(new Error('relation "employees" does not exist at /app/src/db.js:12'));
  assert.equal(res.statusCode, 500);
  assert.equal(res.body.error.code, 'INTERNAL_ERROR');
  assert.ok(!JSON.stringify(res.body).includes('employees'));
  assert.ok(!JSON.stringify(res.body).includes('/app/src'));
  assert.ok(lines[0].includes('relation'));
});

test('errors: unknown route -> 404 NOT_FOUND', () => {
  let passed;
  errors.notFoundHandler({ method: 'GET', path: '/api/nope' }, {}, (e) => { passed = e; });
  assert.equal(handle(passed).res.statusCode, 404);
});
