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

module.exports = { UUID, requireUuid };
