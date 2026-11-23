// EN: Small input checks for Service 1. Every value from the URL, the query string or the body is checked
//     here BEFORE it reaches the database; a bad value gives 400 with the field name.
// Franco: Checks so8ayyara lel input fe Service 1. Kol value gai men el URL aw el query aw el body
//     bet-et-check hena ABL ma yewsal el database; value ghalat = 400 ma3 esm el field.
'use strict';
const { badRequest } = require('../../common/errors');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// EN: ids are UUIDs. A malformed id is 400; a well-formed id that does not exist is 404 (contract).
// Franco: el ids UUID. Id shaklo ghalat = 400; id sa7 bas mesh mawgood = 404 (el contract).
function requireUuid(value, field) {
  if (typeof value !== 'string' || !UUID.test(value)) {
    throw badRequest(`${field} must be a UUID`, [{ field, issue: 'not a UUID' }]);
  }
  return value.toLowerCase();
}

// EN: the JSON body must be an object ({...}), not a list, a number or nothing.
// Franco: el JSON body lazem yeb2a object ({...}), mesh list wala rakam wala fady.
function requireBody(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw badRequest('Request body must be a JSON object');
  }
  return body;
}

// EN: a text field: must be a string; spaces at the ends are removed; length between min and max.
// Franco: field text: lazem string; el masafat fel atraf betetshal; el tool bein min w max.
function requireText(value, field, { min = 1, max }) {
  if (typeof value !== 'string') throw badRequest(`${field} must be text`, [{ field, issue: 'missing or not text' }]);
  const text = value.trim();
  if (text.length < min || text.length > max) {
    throw badRequest(`${field} must be ${min}-${max} characters`, [{ field, issue: `length must be ${min}-${max}` }]);
  }
  return text;
}

// EN: true/false only. "true" as text or 1 is refused, so the stored value is always clear.
// Franco: true/false bas. "true" ka text aw 1 marfood, 3ashan el value el mat-khazzana tefdal wadha.
function optionalBoolean(value, field, fallback) {
  if (value === undefined) return fallback;
  if (typeof value !== 'boolean') throw badRequest(`${field} must be true or false`, [{ field, issue: 'not a boolean' }]);
  return value;
}

// EN: a whole number in a range, or null when "nullable" (e.g. validityMonths: null = never expires).
// Franco: rakam sa7 fe range, aw null law "nullable" (zay validityMonths: null = malhash sala7eya).
function optionalInt(value, field, { min, max, nullable = false }) {
  if (value === undefined || (nullable && value === null)) return null;
  if (!Number.isInteger(value) || value < min || value > max) {
    throw badRequest(`${field} must be a whole number from ${min} to ${max}${nullable ? ' or null' : ''}`,
      [{ field, issue: `must be an integer ${min}-${max}` }]);
  }
  return value;
}

module.exports = { UUID, requireUuid, requireBody, requireText, optionalBoolean, optionalInt };
