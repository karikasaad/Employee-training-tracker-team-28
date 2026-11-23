// EN: Helpers for Service 2's API tests. The tests run the REAL app (real auth module, real db.js guard
//     rails, real multer) with FAKE S1, FAKE S3 storage and a FAKE database pool that records every SQL
//     statement. So no Docker services are needed and nothing real is touched.
// Franco: Helpers le API tests bta3et Service 2. El tests beyshaghalo el app el 7a2i2i (auth module 7a2i2i,
//     qawa3ed db.js el 7a2i2eya, multer el 7a2i2i) m3a S1 FAKE w storage S3 FAKE w pool database FAKE
//     beyesgel kol SQL. Ya3ni mesh me7taga services Docker w mafeesh 7aga 7a2i2eya betet-lames.
'use strict';
const crypto = require('node:crypto');
const { createApp } = require('../src/app');
const { createDb } = require('../../common/db');
const { notFound, upstreamUnavailable } = require('../../common/errors');

const EMPLOYEE_ID = '20000000-0000-4000-8000-000000000002';
const TRAINING_ID = '30000000-0000-4000-8000-000000000001';
const TODAY = '2026-11-23';

// ---------------------------------------------------------------- test tokens (real RS256 signature)
const ISSUER = 'https://cognito.test/pool';
const WEB_CLIENT = 'web-client';
const SERVICE_CLIENT = 'service-client';
const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'test-key' };
const authOptions = {
  issuer: ISSUER, webClientIds: [WEB_CLIENT], serviceClientId: SERVICE_CLIENT,
  getKey: async (kid) => (kid === 'test-key' ? jwk : undefined),
};

function token({ sub = 'sub-ahmed', groups = ['Employee'], clientId = WEB_CLIENT, expInSec = 900 } = {}) {
  const now = Math.floor(Date.now() / 1000);
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const head = b64({ alg: 'RS256', kid: 'test-key' });
  const body = b64({ iss: ISSUER, token_use: 'access', client_id: clientId, sub, iat: now - 5, exp: now + expInSec, 'cognito:groups': groups });
  const sig = crypto.sign('RSA-SHA256', Buffer.from(`${head}.${body}`), privateKey).toString('base64url');
  return `${head}.${body}.${sig}`;
}
const tokens = {
  employee: () => token(),
  manager: () => token({ sub: 'sub-mona', groups: ['Manager'] }),
  service: () => token({ sub: 'sub-jobs', groups: [], clientId: SERVICE_CLIENT }),
  expired: () => token({ expInSec: -60 }),
};

// ---------------------------------------------------------------- fakes
// EN: a fake pg Pool. It records every SQL + params and answers the INSERT ... RETURNING like Postgres.
//     It is wrapped by the REAL createDb, so the "no quotes in SQL" guard rails run in the tests too.
// Franco: pg Pool fake. Beyesgel kol SQL + params w beyrod 3ala INSERT ... RETURNING zay Postgres.
//     Mel-lef bel createDb el 7a2i2i, f qawa3ed "mafeesh quotes fel SQL" betesh-taghal fel tests kaman.
function createFakePool() {
  const calls = [];
  const pool = { calls, failInsert: false, selectRows: [] };
  const run = async (sql, params = []) => {
    calls.push({ sql, params });
    if (/^\s*INSERT INTO certificates/i.test(sql)) {
      if (pool.failInsert) throw new Error('database is down');
      return {
        rows: [{
          id: crypto.randomUUID(), employee_id: params[0], training_id: params[1], title: params[2], issuer: params[3],
          certificate_number: params[4], issue_date: params[5], expiry_date: params[6], review_status: 'Pending',
          mime_type: params[9], size_bytes: params[10], uploaded_at: new Date('2026-11-23T10:00:00Z'),
          verified_by: null, verified_at: null, reject_reason: null,
        }],
      };
    }
    // EN: any SELECT answers with the rows the test put in pool.selectRows.
    // Franco: ay SELECT beyrod bel rows elly el test 7atta fe pool.selectRows.
    if (/^\s*SELECT/i.test(sql)) return { rows: pool.selectRows };
    return { rows: [] };
  };
  pool.query = run;
  pool.connect = async () => ({ query: run, release() {} });
  return pool;
}

// EN: fake file storage: remembers what was stored.
// Franco: storage fake: beyfakkar eh elly et-khazzen.
function createFakeStorage() {
  const storage = { puts: [], removed: [], fail: false };
  storage.put = async (key, body, contentType) => {
    if (storage.fail) throw new Error('S3 is down');
    storage.puts.push({ key, body, contentType });
  };
  storage.remove = async (key) => { storage.removed.push(key); };
  return storage;
}

// EN: fake S1: knows one training; the caller's profile is Ahmed.
// Franco: S1 fake: 3arfa training wa7da; profile el caller = Ahmed.
function createFakeUpstream() {
  const up = { calls: [], meError: null, trainingError: null };
  up.getMe = async (ctx) => {
    up.calls.push({ name: 'getMe', ctx });
    if (up.meError) throw up.meError;
    return { id: EMPLOYEE_ID, name: 'Ahmed Ali' };
  };
  up.getTraining = async (id, ctx) => {
    up.calls.push({ name: 'getTraining', id, ctx });
    if (up.trainingError) throw up.trainingError;
    if (id !== TRAINING_ID) throw notFound('Training not found');
    return { id, name: 'Fire Safety' };
  };
  return up;
}

// ---------------------------------------------------------------- start the app on a random port
async function startApp() {
  const pool = createFakePool();
  const storage = createFakeStorage();
  const upstream = createFakeUpstream();
  const logs = [];
  const logger = { debug() {}, info: (e, f) => logs.push({ e, f }), warn: (e, f) => logs.push({ e, f }), error: (e, f) => logs.push({ e, f }) };
  const app = createApp({ db: createDb({ pool }), authOptions, upstream, storage, logger, today: () => TODAY });
  const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  const url = `http://127.0.0.1:${server.address().port}`;
  return { url, pool, storage, upstream, logs, close: () => new Promise((resolve) => server.close(resolve)) };
}

// ---------------------------------------------------------------- request helpers
const PDF_BYTES = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.from('fake pdf body SECRET-FILE-CONTENT')]);
const PNG_BYTES = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('png body')]);
const JPEG_BYTES = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('jpeg body')]);

const GOOD_FIELDS = {
  trainingId: TRAINING_ID, title: 'Fire Safety Certificate', issuer: 'Seed Training Institute',
  certificateNumber: 'FS-1001', issueDate: '2026-09-18', expiryDate: '2027-09-18',
};

// EN: POST a multipart form. file = Buffer (or null for "no file"); fields override GOOD_FIELDS;
//     a field set to undefined is left out.
// Franco: POST form multipart. file = Buffer (aw null = mafeesh file); el fields betghayyar GOOD_FIELDS;
//     field = undefined byetshal.
async function upload(ctx, { file = PDF_BYTES, fileName = 'cert.pdf', fileType = 'application/pdf', fields = {}, fileField = 'file', auth = tokens.employee() } = {}) {
  const form = new FormData();
  for (const [k, v] of Object.entries({ ...GOOD_FIELDS, ...fields })) if (v !== undefined) form.append(k, v);
  if (file) form.append(fileField, new Blob([file], { type: fileType }), fileName);
  const headers = auth ? { Authorization: `Bearer ${auth}` } : {};
  const res = await fetch(`${ctx.url}/api/certificates`, { method: 'POST', headers, body: form });
  const text = await res.text();
  let body = null;
  try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, body, headers: res.headers };
}

module.exports = {
  EMPLOYEE_ID, TRAINING_ID, TODAY, tokens, startApp, upload, createFakePool, upstreamUnavailable,
  PDF_BYTES, PNG_BYTES, JPEG_BYTES, GOOD_FIELDS,
};
