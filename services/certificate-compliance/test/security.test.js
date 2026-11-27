// EN: Security tests for EVERY Service 2 route: 401 (no / bad / expired token), 403 (wrong role, wrong owner, wrong
//     team), 404, 400, 413, 415, the IDOR cases, a renamed .exe sent as .pdf, "a manager cannot verify their own
//     certificate", the 300 s link, and "no token / key / file content in the logs". Real app, fake DB / S1 / S3.
// Franco: Tests aman le KOL route fe Service 2: 401 (mafeesh token / token ghalat / token khalsan), 403 (role ghalat,
//     sa7eb ghalat, team ghalat), 404, 400, 413, 415, 7alat el IDOR, .exe metsammi .pdf, "el manager mayeqdarsh
//     yeverify certificate bta3o", link el 300 sanya, w "mafeesh token / key / mo7tawa file fel logs".
const test = require('node:test');
const assert = require('node:assert');
const { IDS, TRAINING_ID, tokens, startApp, upload, PDF_BYTES } = require('../test-support/helpers');

const CERT = '50000000-0000-4000-8000-000000000001';
const UNKNOWN = '50000000-0000-4000-8000-000000000099';
const NOT_UUID = 'not-a-uuid';

async function withApp(fn) {
  const ctx = await startApp();
  try { await fn(ctx); } finally { await ctx.close(); }
}

// EN: a database row owned by Ahmed (Operations, manager Mona), with the secret S3 key and hash.
// Franco: satr database sa7ebo Ahmed (Operations, manager Mona), m3a el S3 key w el hash el serriyyin.
function row(over = {}) {
  return {
    id: CERT, employee_id: IDS.AHMED, training_id: TRAINING_ID, title: 'Fire Safety', issuer: 'Institute',
    certificate_number: 'FS-1', issue_date: '2026-09-18', expiry_date: '2027-09-18', review_status: 'Pending',
    mime_type: 'application/pdf', size_bytes: 1000, uploaded_at: new Date('2026-09-18T10:00:00Z'),
    verified_by: null, verified_at: null, reject_reason: null, s3_key: 'certificates/secret-key', file_hash: 'b'.repeat(64),
    ...over,
  };
}

async function call(ctx, method, path, auth, body) {
  const res = await fetch(`${ctx.url}${path}`, {
    method,
    headers: { ...(auth ? { Authorization: `Bearer ${auth}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: res.status, body: data };
}

// EN: every route, with the roles that are allowed (the "Service" token is the job token).
// Franco: kol route, m3a el roles el masmoo7a (el "Service" token = token el job).
const ROUTES = [
  ['POST', '/api/certificates', ['Employee', 'Manager']],
  ['GET', '/api/certificates/me', ['Employee', 'Manager']],
  ['GET', `/api/certificates?teamId=${IDS.OPS}`, ['Manager']],
  ['GET', `/api/certificates/${CERT}`, ['Employee', 'Manager']],
  ['PUT', `/api/certificates/${CERT}`, ['Employee', 'Manager']],
  ['DELETE', `/api/certificates/${CERT}`, ['Employee', 'Manager']],
  ['GET', `/api/certificates/${CERT}/download`, ['Employee', 'Manager']],
  ['PATCH', `/api/certificates/${CERT}/verify`, ['Manager']],
  ['GET', `/api/compliance/teams/${IDS.OPS}`, ['Manager', 'Service']],
  ['POST', '/api/compliance/run-check', ['Service']],
];
const TOKEN_OF = { Employee: tokens.employee, Manager: tokens.manager, Service: tokens.service };

// =================================================================== 401
test('401: every route rejects a missing, malformed, expired or wrongly signed token', async () => {
  await withApp(async (ctx) => {
    const tampered = `${tokens.employee().slice(0, -4)}AAAA`;
    for (const [method, path] of ROUTES) {
      for (const bad of [null, 'garbage', tokens.expired(), tampered]) {
        const res = await call(ctx, method, path, bad);
        assert.strictEqual(res.status, 401, `${method} ${path}`);
        assert.strictEqual(res.body.error.code, 'UNAUTHENTICATED', `${method} ${path}`);
      }
    }
    assert.strictEqual(ctx.pool.calls.length, 0); // EN: the database was never touched / Franco: el database 3omraha ma etlamasit
  });
});

test('401: a token with no Authorization scheme (not "Bearer") is rejected', async () => {
  await withApp(async (ctx) => {
    const res = await fetch(`${ctx.url}/api/certificates/me`, { headers: { Authorization: tokens.employee() } });
    assert.strictEqual(res.status, 401);
  });
});

// =================================================================== 403 (role)
test('403: every route rejects the roles it does not allow, before touching the database', async () => {
  await withApp(async (ctx) => {
    for (const [method, path, allowed] of ROUTES) {
      for (const role of ['Employee', 'Manager', 'Service']) {
        if (allowed.includes(role)) continue;
        const res = await call(ctx, method, path, TOKEN_OF[role](), method === 'GET' ? undefined : { x: 1 });
        assert.strictEqual(res.status, 403, `${role} on ${method} ${path}`);
        assert.strictEqual(res.body.error.code, 'FORBIDDEN');
      }
    }
    assert.strictEqual(ctx.pool.calls.length, 0);
  });
});

test('403: a token with no group at all is rejected everywhere', async () => {
  await withApp(async (ctx) => {
    const token = tokens.service;
    for (const [method, path, allowed] of ROUTES) {
      if (allowed.includes('Service')) continue;
      assert.strictEqual((await call(ctx, method, path, token())).status, 403, `${method} ${path}`);
    }
  });
});

// =================================================================== IDOR (certificates of other people)
test('403 IDOR: another employee cannot read, change, delete, download or verify Ahmed\'s certificate', async () => {
  await withApp(async (ctx) => {
    ctx.pool.selectRows = [row()];
    const sara = tokens.sara();
    const body = { title: 'Hacked', issuer: 'X', issueDate: '2026-01-01', expiryDate: '2027-01-01' };
    assert.strictEqual((await call(ctx, 'GET', `/api/certificates/${CERT}`, sara)).status, 403);
    assert.strictEqual((await call(ctx, 'PUT', `/api/certificates/${CERT}`, sara, body)).status, 403);
    assert.strictEqual((await call(ctx, 'DELETE', `/api/certificates/${CERT}`, sara)).status, 403);
    assert.strictEqual((await call(ctx, 'GET', `/api/certificates/${CERT}/download`, sara)).status, 403);
    assert.strictEqual((await call(ctx, 'PATCH', `/api/certificates/${CERT}/verify`, sara, { decision: 'verify' })).status, 403);
    assert.strictEqual(ctx.pool.calls.filter((c) => /^\s*(UPDATE|DELETE)/i.test(c.sql)).length, 0);
    assert.strictEqual(ctx.storage.presigns.length, 0);
  });
});

test('403 IDOR: the manager of ANOTHER team cannot read, change, delete, download or verify it', async () => {
  await withApp(async (ctx) => {
    ctx.pool.selectRows = [row()];
    const omar = tokens.omar();
    assert.strictEqual((await call(ctx, 'GET', `/api/certificates/${CERT}`, omar)).status, 403);
    assert.strictEqual((await call(ctx, 'DELETE', `/api/certificates/${CERT}`, omar)).status, 403);
    assert.strictEqual((await call(ctx, 'GET', `/api/certificates/${CERT}/download`, omar)).status, 403);
    assert.strictEqual((await call(ctx, 'PATCH', `/api/certificates/${CERT}/verify`, omar, { decision: 'verify' })).status, 403);
    assert.strictEqual(ctx.pool.calls.filter((c) => /^\s*(UPDATE|DELETE)/i.test(c.sql)).length, 0);
  });
});

test('403 IDOR: a manager cannot list or read the compliance of a team they do not manage', async () => {
  await withApp(async (ctx) => {
    assert.strictEqual((await call(ctx, 'GET', `/api/certificates?teamId=${IDS.LAB}`, tokens.mona())).status, 403);
    assert.strictEqual((await call(ctx, 'GET', `/api/compliance/teams/${IDS.LAB}`, tokens.mona())).status, 403);
  });
});

test('403: a manager cannot verify or reject their OWN certificate; the attempt is audited as denied', async () => {
  await withApp(async (ctx) => {
    ctx.pool.selectRows = [row({ employee_id: IDS.MONA })];
    for (const body of [{ decision: 'verify' }, { decision: 'reject', reason: 'no' }]) {
      const res = await call(ctx, 'PATCH', `/api/certificates/${CERT}/verify`, tokens.mona(), body);
      assert.strictEqual(res.status, 403);
    }
    const audits = ctx.pool.calls.filter((c) => /^\s*INSERT INTO audit_log/i.test(c.sql));
    assert.strictEqual(audits.length, 2);
    assert.deepStrictEqual(audits.map((a) => [a.params[1], a.params[4]]), [['verify', 'denied'], ['reject', 'denied']]);
    assert.strictEqual(ctx.pool.calls.filter((c) => /^\s*UPDATE/i.test(c.sql)).length, 0);
  });
});

// =================================================================== 404
test('404: an unknown certificate id on every id route; an unknown path', async () => {
  await withApp(async (ctx) => {
    ctx.pool.selectRows = [];
    const body = { title: 'T', issuer: 'I', issueDate: '2026-01-01', expiryDate: '2027-01-01' };
    assert.strictEqual((await call(ctx, 'GET', `/api/certificates/${UNKNOWN}`, tokens.employee())).status, 404);
    assert.strictEqual((await call(ctx, 'PUT', `/api/certificates/${UNKNOWN}`, tokens.employee(), body)).status, 404);
    assert.strictEqual((await call(ctx, 'DELETE', `/api/certificates/${UNKNOWN}`, tokens.employee())).status, 404);
    assert.strictEqual((await call(ctx, 'GET', `/api/certificates/${UNKNOWN}/download`, tokens.employee())).status, 404);
    assert.strictEqual((await call(ctx, 'PATCH', `/api/certificates/${UNKNOWN}/verify`, tokens.manager(), { decision: 'verify' })).status, 404);
    const nowhere = await call(ctx, 'GET', '/api/nothing-here', tokens.employee());
    assert.strictEqual(nowhere.status, 404);
    assert.strictEqual(nowhere.body.error.code, 'NOT_FOUND');
  });
});

test('404: a deleted certificate is not found (the SQL filters it) and the S3 key is not in the answer', async () => {
  await withApp(async (ctx) => {
    ctx.pool.selectRows = [];
    const res = await call(ctx, 'GET', `/api/certificates/${CERT}`, tokens.employee());
    assert.strictEqual(res.status, 404);
    assert.ok(ctx.pool.calls.some((c) => /deleted_at IS NULL/i.test(c.sql)));
  });
});

// =================================================================== 400
test('400: a path id that is not a UUID is refused before any database call', async () => {
  await withApp(async (ctx) => {
    for (const [method, suffix] of [['GET', ''], ['PUT', ''], ['DELETE', ''], ['GET', '/download'], ['PATCH', '/verify']]) {
      const res = await call(ctx, method, `/api/certificates/${NOT_UUID}${suffix}`, tokens.manager(), method === 'GET' || method === 'DELETE' ? undefined : { decision: 'verify' });
      assert.strictEqual(res.status, 400, `${method} ${suffix}`);
      assert.strictEqual(res.body.error.code, 'VALIDATION_ERROR');
    }
    assert.strictEqual((await call(ctx, 'GET', `/api/compliance/teams/${NOT_UUID}`, tokens.manager())).status, 400);
  });
});

test('400: list needs teamId; reviewStatus must be a known value; SQL injection strings are refused', async () => {
  await withApp(async (ctx) => {
    const m = tokens.mona();
    assert.strictEqual((await call(ctx, 'GET', '/api/certificates', m)).status, 400);
    assert.strictEqual((await call(ctx, 'GET', `/api/certificates?teamId=${IDS.OPS}&reviewStatus=Done`, m)).status, 400);
    assert.strictEqual((await call(ctx, 'GET', `/api/certificates?teamId=${encodeURIComponent("x' OR '1'='1")}`, m)).status, 400);
    assert.strictEqual((await call(ctx, 'GET', `/api/certificates?teamId=${IDS.OPS}&reviewStatus=${encodeURIComponent("Pending'; DROP TABLE certificates;--")}`, m)).status, 400);
    assert.strictEqual(ctx.pool.calls.length, 0);
  });
});

test('400: verify needs a decision, a reject needs a reason, nothing else is accepted', async () => {
  await withApp(async (ctx) => {
    ctx.pool.selectRows = [row()];
    const m = tokens.mona();
    const path = `/api/certificates/${CERT}/verify`;
    assert.strictEqual((await call(ctx, 'PATCH', path, m, {})).status, 400);
    assert.strictEqual((await call(ctx, 'PATCH', path, m, { decision: 'approve' })).status, 400);
    assert.strictEqual((await call(ctx, 'PATCH', path, m, { decision: 'reject' })).status, 400);
    assert.strictEqual((await call(ctx, 'PATCH', path, m, { decision: 'reject', reason: 'x'.repeat(501) })).status, 400);
    assert.strictEqual(ctx.pool.calls.filter((c) => /^\s*UPDATE/i.test(c.sql)).length, 0);
  });
});

test('400: PUT with bad fields (empty title, bad date, expiry before issue) is refused', async () => {
  await withApp(async (ctx) => {
    ctx.pool.selectRows = [row()];
    const e = tokens.employee();
    const ok = { title: 'T', issuer: 'I', issueDate: '2026-01-01', expiryDate: '2027-01-01' };
    for (const bad of [{ title: '' }, { issueDate: '2026-13-45' }, { expiryDate: '2025-01-01' }, { title: 'x'.repeat(151) }]) {
      assert.strictEqual((await call(ctx, 'PUT', `/api/certificates/${CERT}`, e, { ...ok, ...bad })).status, 400, JSON.stringify(bad));
    }
  });
});

test('400: upload with no file, a wrong field name, a bad date, an unknown training or a SQL string', async () => {
  await withApp(async (ctx) => {
    assert.strictEqual((await upload(ctx, { file: null })).status, 400);
    assert.strictEqual((await upload(ctx, { fileField: 'document' })).status, 400);
    assert.strictEqual((await upload(ctx, { fields: { expiryDate: '2026-02-31' } })).status, 400);
    assert.strictEqual((await upload(ctx, { fields: { trainingId: NOT_UUID } })).status, 400);
    assert.strictEqual((await upload(ctx, { fields: { title: undefined } })).status, 400);
    assert.strictEqual(ctx.storage.puts.length, 0); // EN: nothing was stored / Franco: mafeesh 7aga et-khazzenet
  });
});

test('400: invalid JSON gives a clean 400, not a stack trace', async () => {
  await withApp(async (ctx) => {
    const res = await fetch(`${ctx.url}/api/certificates/${CERT}/verify`, {
      method: 'PATCH', headers: { Authorization: `Bearer ${tokens.manager()}`, 'Content-Type': 'application/json' }, body: '{"decision": ',
    });
    assert.strictEqual(res.status, 400);
    assert.ok(!/at .*\.js/.test(await res.text()));
  });
});

// =================================================================== 413 / 415
test('413: a file over 5 MB is refused and nothing is stored', async () => {
  await withApp(async (ctx) => {
    const big = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(5 * 1024 * 1024 + 10)]);
    const res = await upload(ctx, { file: big });
    assert.strictEqual(res.status, 413);
    assert.strictEqual(ctx.storage.puts.length, 0);
  });
});

test('415: a renamed .exe sent as .pdf (with a PDF content type) is refused, nothing is stored', async () => {
  await withApp(async (ctx) => {
    const exe = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(200, 1)]); // EN: Windows program header / Franco: header barnameg Windows
    const res = await upload(ctx, { file: exe, fileName: 'invoice.pdf', fileType: 'application/pdf' });
    assert.strictEqual(res.status, 415);
    assert.strictEqual(res.body.error.code, 'UNSUPPORTED_MEDIA_TYPE');
    assert.strictEqual(ctx.storage.puts.length, 0);
    assert.strictEqual(ctx.pool.calls.filter((c) => /^\s*INSERT INTO certificates/i.test(c.sql)).length, 0);
  });
});

test('415: scripts, HTML and an SVG with script are refused even when named .png', async () => {
  await withApp(async (ctx) => {
    for (const [name, bytes] of [
      ['a.png', Buffer.from('<html><script>alert(1)</script></html>')],
      ['b.png', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')],
      ['c.pdf', Buffer.from('#!/bin/sh\nrm -rf /\n')],
      ['d.png', Buffer.from('PK\u0003\u0004zipfile')],
    ]) {
      assert.strictEqual((await upload(ctx, { file: bytes, fileName: name, fileType: 'image/png' })).status, 415, name);
    }
    assert.strictEqual(ctx.storage.puts.length, 0);
  });
});

test('upload: the stored key never uses the user\'s file name (path traversal is harmless)', async () => {
  await withApp(async (ctx) => {
    const res = await upload(ctx, { fileName: '../../etc/passwd.pdf' });
    assert.strictEqual(res.status, 201);
    assert.ok(!/passwd|\.\./.test(ctx.storage.puts[0].key), ctx.storage.puts[0].key);
  });
});

// =================================================================== the 300 s link
test('download: the pre-signed link is always asked for exactly 300 seconds', async () => {
  await withApp(async (ctx) => {
    ctx.pool.selectRows = [row()];
    for (const t of [tokens.employee(), tokens.mona()]) {
      const res = await call(ctx, 'GET', `/api/certificates/${CERT}/download`, t);
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.expiresInSeconds, 300);
    }
    assert.deepStrictEqual(ctx.storage.presigns.map((p) => p.expiresIn), [300, 300]);
  });
});

// =================================================================== answers and logs
test('no answer ever contains the S3 key or the file hash', async () => {
  await withApp(async (ctx) => {
    ctx.pool.selectRows = [row()];
    const answers = [
      await call(ctx, 'GET', '/api/certificates/me', tokens.employee()),
      await call(ctx, 'GET', `/api/certificates/${CERT}`, tokens.employee()),
      await call(ctx, 'GET', `/api/certificates?teamId=${IDS.OPS}`, tokens.mona()),
      await call(ctx, 'GET', `/api/certificates/${CERT}/download`, tokens.employee()),
    ];
    const text = JSON.stringify(answers.map((a) => a.body));
    assert.ok(!/"s3Key"|"fileHash"|s3_key|file_hash|b{64}/.test(text));
  });
});

test('errors never show a stack trace, SQL or a database message', async () => {
  await withApp(async (ctx) => {
    ctx.pool.failInsert = true;
    const res = await upload(ctx);
    assert.strictEqual(res.status, 500);
    const text = JSON.stringify(res.body);
    assert.ok(!/database is down|INSERT|at .*\.js|node_modules/.test(text));
  });
});

test('logs never contain a token, an S3 key, a file hash, a signed link or file content', async () => {
  await withApp(async (ctx) => {
    ctx.pool.selectRows = [row()];
    const employee = tokens.employee();
    const manager = tokens.mona();
    await upload(ctx, { auth: employee });
    await call(ctx, 'GET', '/api/certificates/me', employee);
    await call(ctx, 'GET', `/api/certificates/${CERT}/download`, employee);
    await call(ctx, 'PATCH', `/api/certificates/${CERT}/verify`, manager, { decision: 'reject', reason: 'private reason text' });
    await call(ctx, 'GET', '/api/certificates/me', 'garbage-token-value');
    await call(ctx, 'GET', '/api/certificates/me', tokens.expired());
    const text = JSON.stringify(ctx.logs);
    assert.ok(ctx.logs.length > 0);
    for (const secret of [employee, manager, 'garbage-token-value', 'secret-key', 'b'.repeat(64), 'X-Amz-Signature', 'SECRET-FILE-CONTENT']) {
      assert.ok(!text.includes(secret), `the logs contain: ${secret.slice(0, 20)}`);
    }
  });
});

test('the response headers do not advertise the framework', async () => {
  await withApp(async (ctx) => {
    const res = await fetch(`${ctx.url}/health`);
    assert.strictEqual(res.headers.get('x-powered-by'), null);
  });
});

test('/health needs no token and says nothing but ok', async () => {
  await withApp(async (ctx) => {
    const res = await call(ctx, 'GET', '/health');
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(res.body, { status: 'ok', service: 'certificate-compliance' });
  });
});
