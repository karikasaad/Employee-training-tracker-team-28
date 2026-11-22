// EN: Structured JSON logs for every service: one line per event, ready for CloudWatch Logs.
//     Secrets NEVER reach the log: tokens, passwords, Authorization headers, cookies and anything that
//     looks like a JWT are replaced with "[REDACTED]" before a line is written.
// Franco: Logs JSON le kol service: satr wa7ed le kol event, gahez le CloudWatch Logs.
//     El secrets 3omraha ma tewsal el log: el tokens w el passwords w el Authorization headers w el
//     cookies w ay 7aga shakl JWT betet-ghayyar le "[REDACTED]" abl ma el satr yetkteb.
'use strict';
const crypto = require('node:crypto');

const REDACTED = '[REDACTED]';
// EN: key names whose values are always hidden.
// Franco: asamy el keys elly el values bta3etha dayman mestakhabbeya.
const SECRET_KEY = /authorization|token|password|passwd|secret|cookie|api[-_]?key|credential|session/i;
// EN: a JWT anywhere inside a string (three base64url parts starting with eyJ).
// Franco: ay JWT gowwa ay string (3 agzaa base64url btebda2 b eyJ).
const JWT_PATTERN = /eyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]+/g;
const BEARER_PATTERN = /(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi;

function redact(value, depth = 0) {
  if (depth > 6) return '[DEPTH]';
  if (typeof value === 'string') return value.replace(JWT_PATTERN, REDACTED).replace(BEARER_PATTERN, `$1 ${REDACTED}`);
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = SECRET_KEY.test(k) ? REDACTED : redact(v, depth + 1);
    return out;
  }
  return value;
}

// EN: createLogger('employee-training') -> logger.info('event', {...}). `write` can be replaced in tests
//     (or later by Yahia's CloudWatch shipper); by default it prints to stdout, which Docker collects.
// Franco: createLogger('employee-training') -> logger.info('event', {...}). `write` momken yetghayyar fel
//     tests (aw ba3den bel CloudWatch shipper bta3 Yahia); by default beyetba3 3al stdout w Docker beylemmo.
function createLogger(service, { write = (line) => process.stdout.write(`${line}\n`), level = process.env.LOG_LEVEL || 'info' } = {}) {
  const order = { debug: 10, info: 20, warn: 30, error: 40 };
  function log(lvl, event, fields = {}) {
    if (order[lvl] < (order[level] || 20)) return;
    write(JSON.stringify(redact({ timestamp: new Date().toISOString(), level: lvl, service, event, ...fields })));
  }
  return {
    debug: (e, f) => log('debug', e, f), info: (e, f) => log('info', e, f),
    warn: (e, f) => log('warn', e, f), error: (e, f) => log('error', e, f),
  };
}

// EN: X-Request-Id: reuse the caller's id if it looks safe (so one user action can be followed across all
//     three services), otherwise make a new one. Returned in the response header too.
// Franco: X-Request-Id: nesta3mel id el caller law shaklo aman (3ashan netaba3 action wa7ed 3abr el 3
//     services), w law la2 ne3mel wa7ed gedeed. Beyerga3 fel response header kaman.
function requestIdMiddleware(req, res, next) {
  const incoming = req.headers['x-request-id'];
  req.requestId = typeof incoming === 'string' && /^[A-Za-z0-9-]{8,64}$/.test(incoming) ? incoming : crypto.randomUUID();
  res.setHeader('X-Request-Id', req.requestId);
  next();
}

// EN: one log line per request when the response finishes. We log the PATH only, never the query string
//     or the body (they can hold personal data), and never headers. 401/403 are logged as "warn" with
//     their own event names, so repeated failures are easy to find and count in CloudWatch.
// Franco: satr log wa7ed le kol request lama el response yekhlas. Bn-log el PATH bas, mesh el query
//     string wala el body (momken yeb2a feehom data shakhseya), wala el headers. 401/403 betet-log
//     "warn" b asamy events khasa, 3ashan el failures el metkarrara tetla2y w tet3ad bsohoola fel CloudWatch.
function requestLogger(logger) {
  return function logRequest(req, res, next) {
    const started = process.hrtime.bigint();
    res.on('finish', () => {
      const status = res.statusCode;
      const event = status === 401 ? 'auth_failure'
        : status === 403 ? 'forbidden'
          : status === 400 ? 'validation_error'
            : status >= 500 ? 'server_error' : 'request';
      const level = status >= 500 ? 'error' : status === 401 || status === 403 ? 'warn' : 'info';
      logger[level](event, {
        requestId: req.requestId,
        method: req.method,
        path: (req.originalUrl || req.url || '').split('?')[0],
        status,
        durationMs: Number((process.hrtime.bigint() - started) / 1_000_000n),
        userSub: req.user ? req.user.sub : null,
        roles: req.user ? req.user.roles : null,
        errorCode: res.locals ? res.locals.errorCode : undefined,
        ip: req.ip,
      });
    });
    next();
  };
}

module.exports = { createLogger, redact, requestIdMiddleware, requestLogger, REDACTED };
