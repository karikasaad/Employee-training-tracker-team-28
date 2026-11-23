// EN: Shared helpers for Service 1's API tests. The tests run the REAL app against a REAL Postgres
//     database loaded with infra/db/seed.sql, connected as the least-privilege role svc_s1 (exactly like
//     production). Tokens are signed with a test RSA key and checked by the REAL auth module.
//     WARNING: resetDatabase() re-runs the seed, which wipes the data. Use your local dev database only.
// Franco: Helpers moshtaraka le API tests bta3et Service 1. El tests beyshaghalo el app el 7a2i2i 3ala
//     database Postgres 7a2i2eya feeha el seed, w bey-connect bel role svc_s1 (zay el production bel
//     zabt). El tokens mamdeya b RSA key tagreby w el auth module el 7a2i2i bey-check-ha.
//     TA7ZEER: resetDatabase() bey3eed el seed, ya3ni beyemsa7 el data. Esta3melo 3ala el database el local bas.
//
// Settings (environment) / el settings:
//   S1_TEST_DB_HOST, S1_TEST_DB_PORT, S1_TEST_DB_NAME      where the database is (e.g. localhost, 5432, ett)
//   S1_TEST_DB_PASSWORD                                    password of svc_s1 (DB_S1_PASSWORD in your .env)
//   S1_TEST_ADMIN_USER, S1_TEST_ADMIN_PASSWORD             admin user, ONLY to reset the seed before the tests
// If S1_TEST_DB_HOST is not set, the database tests are skipped (the /health test still runs).
'use strict';
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');

// ---------------------------------------------------------------- seed ids (infra/db/seed.sql)
const IDS = {
  OPS: '10000000-0000-4000-8000-000000000001',
  LAB: '10000000-0000-4000-8000-000000000002',
  UNKNOWN_TEAM: '10000000-0000-4000-8000-000000000099',
  MONA: '20000000-0000-4000-8000-000000000001', // manager of Operations
  AHMED: '20000000-0000-4000-8000-000000000002',
  SARA: '20000000-0000-4000-8000-000000000003',
  YOUSSEF: '20000000-0000-4000-8000-000000000004',
  OMAR: '20000000-0000-4000-8000-000000000005', // manager of Laboratory
  NOUR: '20000000-0000-4000-8000-000000000006',
  HANA: '20000000-0000-4000-8000-000000000007',
  TAREK: '20000000-0000-4000-8000-000000000008',
  UNKNOWN_EMPLOYEE: '20000000-0000-4000-8000-000000000099',
};

const env = process.env;
const dbEnabled = Boolean(env.S1_TEST_DB_HOST);
const skipDb = dbEnabled ? false : 'set S1_TEST_DB_HOST (see test-support/helpers.js) to run the database tests';

function baseDbConfig() {
  return { host: env.S1_TEST_DB_HOST, port: Number(env.S1_TEST_DB_PORT || 5432), database: env.S1_TEST_DB_NAME || 'ett' };
}

// ---------------------------------------------------------------- database
let appPool = null;
let appDb = null;

// EN: the app's database: role svc_s1 through services/common/db.js (same guard rails as production).
// Franco: database el app: el role svc_s1 3an taree2 services/common/db.js (nafs qawa3ed el aman).
function getAppDb() {
  if (!appDb) {
    const { Pool } = require('pg');
    const { createDb } = require('../../common/db');
    appPool = new Pool({ ...baseDbConfig(), user: 'svc_s1', password: env.S1_TEST_DB_PASSWORD || '', max: 3 });
    appDb = createDb({ pool: appPool });
  }
  return appDb;
}

// EN: reload the seed as the admin user, then give every seeded employee a test Cognito sub
//     ("sub-" + the part of the e-mail before @), which the test tokens use.
// Franco: n-reload el seed bel admin, w nedy kol mowazzaf sub Cognito tagreby ("sub-" + el goz2 abl
//     el @ fel e-mail), w el test tokens betesta3melo.
async function resetDatabase() {
  const { Client } = require('pg');
  const admin = new Client({ ...baseDbConfig(), user: env.S1_TEST_ADMIN_USER || 'postgres', password: env.S1_TEST_ADMIN_PASSWORD || '' });
  await admin.connect();
  try {
    const seedFile = path.join(__dirname, '..', '..', '..', 'infra', 'db', 'seed.sql');
    // EN: drop the psql-only lines (\set, \echo), which the pg library does not understand.
    // Franco: nesheel el soto7 bta3et psql bas (\set, \echo) 3ashan maktabet pg mabtefhamhash.
    const sql = fs.readFileSync(seedFile, 'utf8').split(/\r?\n/).filter((l) => !l.trim().startsWith('\\')).join('\n');
    await admin.query(sql);
    await admin.query("UPDATE employees SET cognito_sub = 'sub-' || split_part(email, '@', 1)");
  } finally {
    await admin.end();
  }
}

async function closeDb() {
  if (appPool) await appPool.end();
  appPool = null;
  appDb = null;
}

// ---------------------------------------------------------------- tokens
const ISSUER = 'https://cognito.test/pool';
const WEB_CLIENT = 'web-client';
const SERVICE_CLIENT = 'service-client';
const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'test-key' };
const authOptions = {
  issuer: ISSUER, webClientIds: [WEB_CLIENT], serviceClientId: SERVICE_CLIENT,
  getKey: async (kid) => (kid === 'test-key' ? jwk : undefined),
};

// EN: a signed access token. as = the e-mail name of a seeded user (e.g. 'ahmed'); groups = Cognito groups.
// Franco: access token mamdy. as = esm el user fel seed (zay 'ahmed'); groups = groups Cognito.
function token({ as = 'ahmed', groups = ['Employee'], clientId = WEB_CLIENT, expInSec = 900 } = {}) {
  const now = Math.floor(Date.now() / 1000);
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const head = b64({ alg: 'RS256', kid: 'test-key' });
  const body = b64({ iss: ISSUER, token_use: 'access', client_id: clientId, sub: `sub-${as}`, iat: now - 5, exp: now + expInSec, 'cognito:groups': groups });
  const sig = crypto.sign('RSA-SHA256', Buffer.from(`${head}.${body}`), privateKey).toString('base64url');
  return `${head}.${body}.${sig}`;
}
const tokens = {
  ahmed: () => token({ as: 'ahmed' }),
  sara: () => token({ as: 'sara' }),
  youssef: () => token({ as: 'youssef' }),
  nour: () => token({ as: 'nour' }),
  mona: () => token({ as: 'mona.manager', groups: ['Manager'] }),
  omar: () => token({ as: 'omar.manager', groups: ['Manager'] }),
  service: () => token({ as: 'jobs', groups: [], clientId: SERVICE_CLIENT }),
  expired: () => token({ as: 'ahmed', expInSec: -60 }),
  stranger: () => token({ as: 'not-provisioned' }),
};

// ---------------------------------------------------------------- HTTP
const quietLogger = { debug() {}, info() {}, warn() {}, error() {} };

function makeApp(extra = {}) {
  const { createApp } = require('../src/app');
  return createApp({ db: getAppDb(), authOptions, logger: quietLogger, ...extra });
}

// EN: start the app on a free port, make one request, stop the app. Returns { status, body, headers }.
// Franco: neshaghal el app 3ala port fady, ne3mel request wa7ed, w ne2fel. Beyrga3 { status, body, headers }.
function call(app, method, urlPath, { token: tok, body, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const payload = body === undefined ? null : (typeof body === 'string' ? body : JSON.stringify(body));
      const req = http.request({
        port: server.address().port, method, path: urlPath,
        headers: {
          ...(tok ? { Authorization: `Bearer ${tok}` } : {}),
          ...(payload !== null ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
          ...headers,
        },
      }, (res) => {
        let data = '';
        res.on('data', (c) => { data += c; });
        res.on('end', () => {
          server.close();
          let parsed = data;
          try { parsed = data ? JSON.parse(data) : null; } catch { /* keep text */ }
          resolve({ status: res.statusCode, body: parsed, headers: res.headers });
        });
      });
      req.on('error', (e) => { server.close(); reject(e); });
      if (payload !== null) req.write(payload);
      req.end();
    });
  });
}

module.exports = { IDS, skipDb, resetDatabase, closeDb, getAppDb, makeApp, call, token, tokens, authOptions };
