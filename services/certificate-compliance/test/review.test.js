// EN: API tests for download (5.6) and verify / reject (5.7): success, every error code, the IDOR cases,
//     "a manager cannot verify their own certificate", and the audit rows.
// Franco: API tests lel download (5.6) w verify / reject (5.7): el nagah w kol error code w 7alat el IDOR w
//     "el manager mayeqdarsh yeverify certificate bta3o" w satoor el audit.
const test = require('node:test');
const assert = require('node:assert');
const { IDS, TRAINING_ID, tokens, startApp } = require('../test-support/helpers');

const CERT_ID = '50000000-0000-4000-8000-000000000001';
const UNKNOWN_ID = '50000000-0000-4000-8000-000000000099';

async function withApp(fn) {
  const ctx = await startApp();
  try { await fn(ctx); } finally { await ctx.close(); }
}

// EN: a database row. Owner = Ahmed (Operations, manager Mona). It includes s3_key like findById does.
// Franco: satr database. El sa7eb = Ahmed (Operations, manager Mona). Feeh s3_key zay findById.
function row(over = {}) {
  return {
    id: CERT_ID, employee_id: IDS.AHMED, training_id: TRAINING_ID, title: 'Fire Safety Certificate',
    issuer: 'Seed Training Institute', certificate_number: 'FS-1001', issue_date: '2026-09-18', expiry_date: '2027-09-18',
    review_status: 'Pending', mime_type: 'application/pdf', size_bytes: 120000, uploaded_at: new Date('2026-09-18T10:00:00Z'),
    verified_by: null, verified_at: null, reject_reason: null, s3_key: 'certificates/secret-key', file_hash: 'a'.repeat(64),
    ...over,
  };
}

const call = (ctx, method, path, auth = tokens.employee(), body) => fetch(`${ctx.url}${path}`, {
  method,
  headers: { ...(auth ? { Authorization: `Bearer ${auth}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
  body: body ? JSON.stringify(body) : undefined,
}).then(async (res) => {
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
});

const auditRows = (ctx) => ctx.pool.calls.filter((c) => /^\s*INSERT INTO audit_log/i.test(c.sql));
const updateCalls = (ctx) => ctx.pool.calls.filter((c) => /^\s*UPDATE/i.test(c.sql));
const verify = (ctx, auth, body, id = CERT_ID) => call(ctx, 'PATCH', `/api/certificates/${id}/verify`, auth, body);

// =================================================================== 5.6 download
test('5.6 200: the owner gets a 5-minute attachment link for the stored key; audit row (download, success)', async () => {
  await withApp(async (ctx) => {
    ctx.pool.selectRows = [row()];
    const res = await call(ctx, 'GET', `/api/certificates/${CERT_ID}/download`, tokens.employee());
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.expiresInSeconds, 300);
    assert.match(res.body.url, /^https:\/\/files\.test\/certificates\/secret-key\?/);
    const [signed] = ctx.storage.presigns;
    assert.strictEqual(signed.key, 'certificates/secret-key');
    assert.strictEqual(signed.expiresIn, 300);
    assert.strictEqual(signed.mimeType, 'application/pdf');
    assert.strictEqual(signed.fileName, `certificate-${CERT_ID}.pdf`); // EN: our id, never the user's file name
    const [audit] = auditRows(ctx);
    assert.deepStrictEqual([audit.params[0], audit.params[1], audit.params[2], audit.params[4]], [IDS.AHMED, 'download', CERT_ID, 'success']);
  });
});

test('5.6 200: the manager of the owner\'s team can download; the audit actor is the manager', async () => {
  await withApp(async (ctx) => {
    ctx.pool.selectRows = [row({ mime_type: 'image/png' })];
    const res = await call(ctx, 'GET', `/api/certificates/${CERT_ID}/download`, tokens.mona());
    assert.strictEqual(res.status, 200);
    assert.strictEqual(ctx.storage.presigns[0].fileName, `certificate-${CERT_ID}.png`);
    assert.strictEqual(auditRows(ctx)[0].params[0], IDS.MONA);
  });
});

test('5.6 403 (IDOR): another employee and another team\'s manager get no link; "denied" audit rows', async () => {
  await withApp(async (ctx) => {
    ctx.pool.selectRows = [row()];
    assert.strictEqual((await call(ctx, 'GET', `/api/certificates/${CERT_ID}/download`, tokens.sara())).status, 403);
    assert.strictEqual((await call(ctx, 'GET', `/api/certificates/${CERT_ID}/download`, tokens.omar())).status, 403);
    assert.strictEqual(ctx.storage.presigns.length, 0);
    const audits = auditRows(ctx);
    assert.strictEqual(audits.length, 2);
    assert.ok(audits.every((a) => a.params[1] === 'download' && a.params[4] === 'denied'));
  });
});

test('5.6 400 bad id / 401 no token / 403 Service token / 404 unknown id', async () => {
  await withApp(async (ctx) => {
    assert.strictEqual((await call(ctx, 'GET', '/api/certificates/nope/download')).status, 400);
    assert.strictEqual((await call(ctx, 'GET', `/api/certificates/${CERT_ID}/download`, null)).status, 401);
    assert.strictEqual((await call(ctx, 'GET', `/api/certificates/${CERT_ID}/download`, tokens.service())).status, 403);
    ctx.pool.selectRows = [];
    assert.strictEqual((await call(ctx, 'GET', `/api/certificates/${UNKNOWN_ID}/download`)).status, 404);
    assert.strictEqual(ctx.storage.presigns.length, 0);
  });
});

test('5.6 500: signing fails -> generic error, and no "download" is claimed in the audit log', async () => {
  await withApp(async (ctx) => {
    ctx.pool.selectRows = [row()];
    ctx.storage.presignedDownloadUrl = async () => { throw new Error('signer broke'); };
    const res = await call(ctx, 'GET', `/api/certificates/${CERT_ID}/download`);
    assert.strictEqual(res.status, 500);
    assert.ok(!JSON.stringify(res.body).includes('signer broke'));
    assert.strictEqual(auditRows(ctx).length, 0);
  });
});

test('5.6: the signed link is never written to the logs', async () => {
  await withApp(async (ctx) => {
    ctx.pool.selectRows = [row()];
    await call(ctx, 'GET', `/api/certificates/${CERT_ID}/download`);
    assert.ok(ctx.logs.length > 0);
    assert.ok(!JSON.stringify(ctx.logs).includes('X-Amz-Signature'));
  });
});

// =================================================================== 5.7 verify / reject
test('5.7 200: the manager verifies a Pending certificate; audit row (verify, success)', async () => {
  await withApp(async (ctx) => {
    ctx.pool.selectRows = [row()];
    ctx.pool.updateRows = [row({ review_status: 'Verified', verified_by: IDS.MONA, verified_at: new Date('2026-11-23T12:00:00Z') })];
    const res = await verify(ctx, tokens.mona(), { decision: 'verify', reason: null });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.reviewStatus, 'Verified');
    assert.strictEqual(res.body.verifiedBy, IDS.MONA);
    assert.ok(!('s3Key' in res.body) && !('fileHash' in res.body));
    const [update] = updateCalls(ctx);
    assert.deepStrictEqual(update.params, [CERT_ID, 'Verified', IDS.MONA, null, 'Pending']); // EN: the manager id comes from S1 / Franco: id el manager men S1
    assert.match(update.sql, /review_status = \$5/);
    const [audit] = auditRows(ctx);
    assert.deepStrictEqual([audit.params[0], audit.params[1], audit.params[2], audit.params[4]], [IDS.MONA, 'verify', CERT_ID, 'success']);
  });
});

test('5.7 200: the manager rejects with a reason; audit row (reject, success)', async () => {
  await withApp(async (ctx) => {
    ctx.pool.selectRows = [row()];
    ctx.pool.updateRows = [row({ review_status: 'Rejected', verified_by: IDS.MONA, reject_reason: 'The scan is unreadable' })];
    const res = await verify(ctx, tokens.mona(), { decision: 'reject', reason: '  The scan is unreadable ' });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.reviewStatus, 'Rejected');
    assert.strictEqual(res.body.rejectReason, 'The scan is unreadable');
    assert.deepStrictEqual(updateCalls(ctx)[0].params, [CERT_ID, 'Rejected', IDS.MONA, 'The scan is unreadable', 'Pending']);
    assert.strictEqual(auditRows(ctx)[0].params[1], 'reject');
  });
});

test('5.7 400: bad decision, reject without a reason, reason longer than 500, no body; nothing is read or changed', async () => {
  await withApp(async (ctx) => {
    for (const body of [{ decision: 'approve' }, { decision: 'reject' }, { decision: 'reject', reason: '   ' },
      { decision: 'reject', reason: 'x'.repeat(501) }, {}, undefined]) {
      assert.strictEqual((await verify(ctx, tokens.mona(), body)).status, 400, JSON.stringify(body));
    }
    assert.strictEqual((await verify(ctx, tokens.mona(), { decision: 'verify' }, 'nope')).status, 400);
    assert.strictEqual(ctx.pool.calls.length, 0);
  });
});

test('5.7 409: already decided (the UPDATE finds no Pending row); no audit row', async () => {
  await withApp(async (ctx) => {
    ctx.pool.selectRows = [row({ review_status: 'Verified' })];
    ctx.pool.updateRows = [];
    const res = await verify(ctx, tokens.mona(), { decision: 'verify' });
    assert.strictEqual(res.status, 409);
    assert.strictEqual(res.body.error.code, 'CONFLICT');
    assert.strictEqual(auditRows(ctx).length, 0);
  });
});

test('5.7 403: a manager can NEVER verify or reject their own certificate; "denied" audit row, no UPDATE', async () => {
  await withApp(async (ctx) => {
    ctx.pool.selectRows = [row({ employee_id: IDS.MONA })]; // EN: Mona owns it / Franco: Mona hiya el sa7ba
    const verified = await verify(ctx, tokens.mona(), { decision: 'verify' });
    const rejected = await verify(ctx, tokens.mona(), { decision: 'reject', reason: 'no' });
    assert.strictEqual(verified.status, 403);
    assert.strictEqual(rejected.status, 403);
    assert.strictEqual(updateCalls(ctx).length, 0);
    const audits = auditRows(ctx);
    assert.deepStrictEqual(audits.map((a) => [a.params[0], a.params[1], a.params[4]]), [[IDS.MONA, 'verify', 'denied'], [IDS.MONA, 'reject', 'denied']]);
  });
});

test('5.7 403: an Employee, a Service token and the manager of ANOTHER team cannot decide', async () => {
  await withApp(async (ctx) => {
    ctx.pool.selectRows = [row()];
    assert.strictEqual((await verify(ctx, tokens.employee(), { decision: 'verify' })).status, 403);
    assert.strictEqual((await verify(ctx, tokens.service(), { decision: 'verify' })).status, 403);
    assert.strictEqual((await verify(ctx, tokens.omar(), { decision: 'verify' })).status, 403);
    assert.strictEqual(updateCalls(ctx).length, 0);
  });
});

test('5.7 401 no token / 404 unknown id', async () => {
  await withApp(async (ctx) => {
    assert.strictEqual((await verify(ctx, null, { decision: 'verify' })).status, 401);
    ctx.pool.selectRows = [];
    assert.strictEqual((await verify(ctx, tokens.mona(), { decision: 'verify' }, UNKNOWN_ID)).status, 404);
  });
});
