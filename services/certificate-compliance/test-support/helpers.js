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
const { notFound, forbidden, upstreamUnavailable } = require('../../common/errors');

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
  sara: () => token({ sub: 'sub-sara' }),
  manager: () => token({ sub: 'sub-mona', groups: ['Manager'] }),
  mona: () => token({ sub: 'sub-mona', groups: ['Manager'] }),
  omar: () => token({ sub: 'sub-omar', groups: ['Manager'] }),
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
  const pool = { calls, failInsert: false, selectRows: [], flagRows: [], flagReads: [], updateRows: [] };
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
    // EN: compliance_flags SELECTs answer from pool.flagReads (one entry per read, in order), then pool.flagRows.
    // Franco: SELECT bta3 compliance_flags beyrod men pool.flagReads (3'rd el 2ra2a, bel tarteeb), ba3dein pool.flagRows.
    if (/INSERT INTO compliance_flags/i.test(sql)) return { rows: [{ id: crypto.randomUUID() }] };
    if (/UPDATE compliance_flags SET resolved_at/i.test(sql)) return { rows: [{ id: params[0] }] };
    if (/UPDATE compliance_flags SET notified_at/i.test(sql)) return { rows: [] };
    if (/^\s*SELECT/i.test(sql)) {
      if (/FROM compliance_flags/i.test(sql)) return { rows: pool.flagReads.length ? pool.flagReads.shift() : pool.flagRows };
      return { rows: pool.selectRows };
    }
    // EN: UPDATE ... RETURNING answers with pool.updateRows ([] = no row matched, e.g. not Pending any more).
    // Franco: UPDATE ... RETURNING beyrod b pool.updateRows ([] = mafeesh satr etatabaq, masalan mesh Pending khalas).
    if (/^\s*UPDATE/i.test(sql)) return { rows: pool.updateRows };
    return { rows: [] };
  };
  pool.query = run;
  pool.connect = async () => ({ query: run, release() {} });
  return pool;
}

// EN: fake file storage: remembers what was stored.
// Franco: storage fake: beyfakkar eh elly et-khazzen.
function createFakeStorage() {
  const storage = { puts: [], removed: [], presigns: [], fail: false };
  // EN: a fake download link; it remembers what it was asked to sign.
  // Franco: link download fake; beyfakkar eh elly et-talab yewa22a3o.
  storage.presignedDownloadUrl = async (key, options) => {
    storage.presigns.push({ key, ...options });
    return `https://files.test/${key}?X-Amz-Signature=abc123&X-Amz-Expires=${options.expiresIn}`;
  };
  storage.put = async (key, body, contentType) => {
    if (storage.fail) throw new Error('S3 is down');
    storage.puts.push({ key, body, contentType });
  };
  storage.remove = async (key) => { storage.removed.push(key); };
  return storage;
}

// EN: fake S1. It knows two teams and four people and answers like the real S1: an employee may only look
//     at themself, a manager only at their own team (403 otherwise), unknown ids give 404.
// Franco: S1 fake. Ya3raf team-een w 4 nas w beyrod zay S1 el 7a2i2i: el mowazzaf yeshoof nafso bas, w el
//     manager team-o bas (3'er keda 403), w id mesh mawgood yedy 404.
const IDS = {
  OPS: '10000000-0000-4000-8000-000000000001',
  LAB: '10000000-0000-4000-8000-000000000002',
  MONA: '20000000-0000-4000-8000-000000000001', // manager of Operations
  AHMED: '20000000-0000-4000-8000-000000000002',
  SARA: '20000000-0000-4000-8000-000000000003',
  OMAR: '20000000-0000-4000-8000-000000000005', // manager of Laboratory
};
const DIRECTORY = [
  { sub: 'sub-mona', id: IDS.MONA, name: 'Mona Hassan', email: 'mona@example.com', teamId: IDS.OPS, managerId: IDS.MONA, role: 'Manager' },
  { sub: 'sub-ahmed', id: IDS.AHMED, name: 'Ahmed Ali', email: 'ahmed@example.com', teamId: IDS.OPS, managerId: IDS.MONA, role: 'Employee' },
  { sub: 'sub-sara', id: IDS.SARA, name: 'Sara Samir', email: 'sara@example.com', teamId: IDS.OPS, managerId: IDS.MONA, role: 'Employee' },
  { sub: 'sub-omar', id: IDS.OMAR, name: 'Omar Fathy', email: 'omar@example.com', teamId: IDS.LAB, managerId: IDS.OMAR, role: 'Manager' },
];
const TEAMS = [{ id: IDS.OPS, managerId: IDS.MONA }, { id: IDS.LAB, managerId: IDS.OMAR }];

function createFakeUpstream() {
  const up = { calls: [], meError: null, trainingError: null, teamsError: null, assignments: [], assignmentsError: null };
  // EN: who is calling? Read the "sub" from the (already verified) test token.
  // Franco: meen beyeklem? Bn2ra el "sub" men el test token.
  const callerOf = (ctx) => {
    const payload = JSON.parse(Buffer.from(ctx.token.split('.')[1], 'base64url').toString('utf8'));
    // EN: the Service token (client-credentials) is a job, not a person. / Franco: Service token = job, mesh shakhs.
    if (payload.client_id === SERVICE_CLIENT) return { id: 'service', role: 'Service' };
    return DIRECTORY.find((p) => p.sub === payload.sub);
  };
  up.getMe = async (ctx) => {
    up.calls.push({ name: 'getMe', ctx });
    if (up.meError) throw up.meError;
    const me = callerOf(ctx);
    if (!me) throw notFound('No employee profile exists for this user');
    return me;
  };
  up.getTraining = async (id, ctx) => {
    up.calls.push({ name: 'getTraining', id, ctx });
    if (up.trainingError) throw up.trainingError;
    if (id !== TRAINING_ID) throw notFound('Training not found');
    return { id, name: 'Fire Safety' };
  };
  up.getEmployee = async (id, ctx) => {
    up.calls.push({ name: 'getEmployee', id, ctx });
    const me = callerOf(ctx);
    const target = DIRECTORY.find((p) => p.id === id);
    if (!target) throw notFound('Employee not found');
    if (me.role !== 'Service' && target.id !== me.id && target.managerId !== me.id) throw forbidden('You are not allowed to see this employee');
    return target;
  };
  up.getTeams = async (ctx) => {
    up.calls.push({ name: 'getTeams', ctx });
    if (up.teamsError) throw up.teamsError;
    const me = callerOf(ctx);
    if (me.role === 'Service') return TEAMS;
    if (me.role !== 'Manager') throw forbidden('Managers only');
    return TEAMS.filter((t) => t.managerId === me.id);
  };
  up.getTeamEmployees = async (teamId, ctx) => {
    up.calls.push({ name: 'getTeamEmployees', teamId, ctx });
    const me = callerOf(ctx);
    const team = TEAMS.find((t) => t.id === teamId);
    if (!team) throw notFound('Team not found');
    if (me.role !== 'Service' && team.managerId !== me.id) throw forbidden('You are not the manager of this team');
    return DIRECTORY.filter((p) => p.teamId === teamId);
  };
  up.getTeamCompletedAssignments = async (teamId, ctx) => {
    up.calls.push({ name: 'getTeamCompletedAssignments', teamId, ctx });
    if (up.assignmentsError) throw up.assignmentsError;
    return up.assignments;
  };
  return up;
}

// EN: fake mailer: remembers every e-mail it was asked to send and answers with ctx.result.
// Franco: mailer fake: beyfakkar kol e-mail et-talab yetba3at w beyrod b ctx.result.
function createFakeMailer() {
  const mailer = { sent: [], result: 'sent' };
  mailer.send = async (message) => { mailer.sent.push(message); return mailer.result; };
  return mailer;
}

// ---------------------------------------------------------------- start the app on a random port
async function startApp() {
  const pool = createFakePool();
  const storage = createFakeStorage();
  const upstream = createFakeUpstream();
  const mailer = createFakeMailer();
  const logs = [];
  const logger = { debug() {}, info: (e, f) => logs.push({ e, f }), warn: (e, f) => logs.push({ e, f }), error: (e, f) => logs.push({ e, f }) };
  const app = createApp({ db: createDb({ pool }), authOptions, upstream, storage, mailer, logger, today: () => TODAY, now: () => new Date(`${TODAY}T12:00:00.000Z`) });
  const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  const url = `http://127.0.0.1:${server.address().port}`;
  return { url, pool, storage, upstream, mailer, logs, close: () => new Promise((resolve) => server.close(resolve)) };
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
  EMPLOYEE_ID, TRAINING_ID, TODAY, IDS, tokens, startApp, upload, createFakePool, upstreamUnavailable,
  PDF_BYTES, PNG_BYTES, JPEG_BYTES, GOOD_FIELDS,
};
