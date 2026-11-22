// EN: One error format for all three services (see docs/API_CONTRACT.md section 1):
//       { "error": { "code": "VALIDATION_ERROR", "message": "...", "details": [...] } }
//     500 errors never leak stack traces, SQL or file paths to the client; the details go to the log only.
// Franco: Format wa7ed lel errors fel 3 services. Errors el 500 3omraha ma betwarry stack trace wala
//     SQL wala paths lel client; el tafaseel betro7 el log bas.
'use strict';
const { PG } = require('./db');

const CODES = {
  400: 'VALIDATION_ERROR', 401: 'UNAUTHENTICATED', 403: 'FORBIDDEN', 404: 'NOT_FOUND', 409: 'CONFLICT',
  413: 'PAYLOAD_TOO_LARGE', 415: 'UNSUPPORTED_MEDIA_TYPE', 500: 'INTERNAL_ERROR', 502: 'UPSTREAM_ERROR', 503: 'UPSTREAM_UNAVAILABLE',
};

class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.code = CODES[status] || 'ERROR';
    this.details = details;
    this.expose = true;
  }
}

// EN: short helpers so route code reads like the contract: throw notFound('Training not found').
// Franco: helpers so8ayyara 3ashan el code yetqera zay el contract: throw notFound('Training not found').
const badRequest = (message, details) => new HttpError(400, message, details);
const unauthorized = (message = 'Authentication required') => new HttpError(401, message);
const forbidden = (message = 'You are not allowed to do this') => new HttpError(403, message);
const notFound = (message = 'Not found') => new HttpError(404, message);
const conflict = (message) => new HttpError(409, message);
const payloadTooLarge = (message = 'Payload too large') => new HttpError(413, message);
const unsupportedMediaType = (message = 'Unsupported media type') => new HttpError(415, message);
const upstreamError = (message = 'A dependent service failed') => new HttpError(502, message);
const upstreamUnavailable = (message = 'A dependent service is unavailable') => new HttpError(503, message);

// EN: database errors -> HTTP: duplicate -> 409, bad id text -> 400, failed CHECK / FK -> 400.
// Franco: errors el database -> HTTP: takraar -> 409, id ghalat -> 400, CHECK aw FK fashal -> 400.
function fromDbError(err) {
  switch (err && err.code) {
    case PG.UNIQUE_VIOLATION: return conflict('This record already exists');
    case PG.INVALID_TEXT: return badRequest('Invalid identifier or value');
    case PG.CHECK_VIOLATION: return badRequest('A value is outside the allowed range');
    case PG.FOREIGN_KEY_VIOLATION: return badRequest('A referenced record does not exist');
    default: return null;
  }
}

// EN: 404 for any route that does not exist (mount after all routes).
// Franco: 404 le ay route mesh mawgood (7ottoh ba3d kol el routes).
function notFoundHandler(req, res, next) {
  next(notFound(`No route for ${req.method} ${req.path}`));
}

// EN: the last Express middleware. Maps any error to the JSON format and status code.
// Franco: akher middleware fe Express. Bey7awwel ay error lel JSON format w el status code.
function errorHandler(logger) {
  // eslint-disable-next-line no-unused-vars
  return function handleError(err, req, res, next) {
    let httpErr = null;
    if (err instanceof HttpError) httpErr = err;
    else if (err && (err.status === 401 || err.status === 403) && err.code) httpErr = new HttpError(err.status, err.message);
    // EN: errors from express.json(): body too big -> 413, broken JSON -> 400.
    // Franco: errors men express.json(): body kebeer -> 413, JSON ba2ez -> 400.
    else if (err && err.type === 'entity.too.large') httpErr = payloadTooLarge('Request body is too large');
    else if (err && err.type === 'entity.parse.failed') httpErr = badRequest('Request body is not valid JSON');
    else httpErr = fromDbError(err);

    if (!httpErr) {
      // EN: unexpected: log the full error for us, send a generic message to the client.
      // Franco: 7aga mesh motawaqqa3a: n-log el error kollo lena, w nebaat resala 3amma lel client.
      if (logger) logger.error('unhandled_error', { requestId: req.requestId, message: err && err.message, stack: err && err.stack });
      httpErr = new HttpError(500, 'Something went wrong. Please try again later.');
    }
    res.locals.errorCode = httpErr.code;
    const body = { error: { code: httpErr.code, message: httpErr.message } };
    if (httpErr.details) body.error.details = httpErr.details;
    res.status(httpErr.status).json(body);
  };
}

module.exports = {
  HttpError, CODES, badRequest, unauthorized, forbidden, notFound, conflict, payloadTooLarge,
  unsupportedMediaType, upstreamError, upstreamUnavailable, fromDbError, notFoundHandler, errorHandler,
};
