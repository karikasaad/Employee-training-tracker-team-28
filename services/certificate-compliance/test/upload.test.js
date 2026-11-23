// EN: API tests for POST /api/certificates: the success cases and EVERY error code (400, 401, 403, 404,
//     413, 415, 500, 503). The app is real; S1, S3 storage and the database pool are fakes.
// Franco: API tests le POST /api/certificates: el 7alat el nagaha w KOL error code (400, 401, 403, 404,
//     413, 415, 500, 503). El app 7a2i2i; S1 w storage S3 w pool el database fakes.
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const {
  EMPLOYEE_ID, TRAINING_ID, tokens, startApp, upload, upstreamUnavailable, PDF_BYTES, PNG_BYTES, JPEG_BYTES,
} = require('../test-support/helpers');

// EN: run one test with a fresh app, and always close it.
// Franco: shaghal test wa7ed b app gedeed, w dayman e2fel-o.
async function withApp(fn) {
  const ctx = await startApp();
  try { await fn(ctx); } finally { await ctx.close(); }
}
const insertCalls = (ctx) => ctx.pool.calls.filter((c) => /^\s*INSERT INTO certificates/i.test(c.sql));
const auditCalls = (ctx) => ctx.pool.calls.filter((c) => /^\s*INSERT INTO audit_log/i.test(c.sql));

// ------------------------------------------------------------------ 201 success
test('201: PDF upload -> Pending certificate owned by the caller', async () => {
  await withApp(async (ctx) => {
    const res = await upload(ctx, { fields: { employeeId: '20000000-0000-4000-8000-000000000003' } });
    assert.strictEqual(res.status, 201);
    assert.strictEqual(res.body.reviewStatus, 'Pending');
    assert.strictEqual(res.body.employeeId, EMPLOYEE_ID); // from S1 (token), NOT from the form
    assert.strictEqual(res.body.trainingId, TRAINING_ID);
    assert.strictEqual(res.body.mimeType, 'application/pdf');
    assert.strictEqual(res.body.sizeBytes, PDF_BYTES.length);
    assert.strictEqual(res.body.validity, 'Valid');
    assert.strictEqual('s3Key' in res.body, false);
    assert.strictEqual('fileHash' in res.body, false);
    // EN: S1 was called with the caller's own token. / Franco: S1 et-nada 3alaih b token el caller nafsoh.
    assert.ok(ctx.upstream.calls.every((c) => c.ctx.token.split('.').length === 3));
  });
});

test('201: the file goes to S3 under a random key (not the user file name), hash is SHA-256', async () => {
  await withApp(async (ctx) => {
    const res = await upload(ctx, { fileName: '../../etc/passwd.pdf' });
    assert.strictEqual(res.status, 201);
    assert.strictEqual(ctx.storage.puts.length, 1);
    const put = ctx.storage.puts[0];
    assert.match(put.key, /^certificates\/[0-9a-f-]{36}$/);
    assert.ok(!put.key.includes('passwd'));
    assert.strictEqual(put.contentType, 'application/pdf');
    assert.ok(put.body.equals(PDF_BYTES));
    const [insert] = insertCalls(ctx);
    assert.strictEqual(insert.params[7], put.key); // s3_key
    assert.strictEqual(insert.params[8], crypto.createHash('sha256').update(PDF_BYTES).digest('hex')); // file_hash
  });
});

test('201: JPEG and PNG are accepted, whatever the Content-Type says', async () => {
  await withApp(async (ctx) => {
    const jpeg = await upload(ctx, { file: JPEG_BYTES, fileName: 'a.bin', fileType: 'application/octet-stream' });
    const png = await upload(ctx, { file: PNG_BYTES, fileName: 'b.txt', fileType: 'text/plain' });
    assert.strictEqual(jpeg.status, 201);
    assert.strictEqual(jpeg.body.mimeType, 'image/jpeg');
    assert.strictEqual(png.status, 201);
    assert.strictEqual(png.body.mimeType, 'image/png');
  });
});

test('201: a Manager can upload their own certificate; optional certificateNumber can be left out', async () => {
  await withApp(async (ctx) => {
    const res = await upload(ctx, { auth: tokens.manager(), fields: { certificateNumber: undefined } });
    assert.strictEqual(res.status, 201);
    assert.strictEqual(res.body.certificateNumber, null);
  });
});

test('201: a file of exactly 5 MB is accepted', async () => {
  await withApp(async (ctx) => {
    const file = Buffer.concat([Buffer.from('%PDF-'), Buffer.alloc(5 * 1024 * 1024 - 5)]);
    const res = await upload(ctx, { file });
    assert.strictEqual(res.status, 201);
    assert.strictEqual(res.body.sizeBytes, 5 * 1024 * 1024);
  });
});

test('201: an audit row (upload, success) is written with the same certificate id', async () => {
  await withApp(async (ctx) => {
    const res = await upload(ctx);
    const [audit] = auditCalls(ctx);
    assert.strictEqual(audit.params[0], EMPLOYEE_ID);
    assert.strictEqual(audit.params[1], 'upload');
    assert.strictEqual(audit.params[2], res.body.id);
    assert.strictEqual(audit.params[4], 'success');
  });
});

test('201: SQL is parameterised: a SQL-injection title is stored as data, never inside the SQL text', async () => {
  await withApp(async (ctx) => {
    const evil = "x'); DROP TABLE certificates; --";
    const res = await upload(ctx, { fields: { title: evil } });
    assert.strictEqual(res.status, 201);
    assert.strictEqual(res.body.title, evil);
    assert.ok(ctx.pool.calls.every((c) => !c.sql.includes('DROP TABLE')));
  });
});

// ------------------------------------------------------------------ 401 / 403
test('401: no token, expired token, and nothing is stored', async () => {
  await withApp(async (ctx) => {
    assert.strictEqual((await upload(ctx, { auth: null })).status, 401);
    assert.strictEqual((await upload(ctx, { auth: tokens.expired() })).status, 401);
    assert.strictEqual(ctx.storage.puts.length, 0);
    assert.strictEqual(ctx.upstream.calls.length, 0);
  });
});

test('403: a Service token is not allowed to upload', async () => {
  await withApp(async (ctx) => {
    const res = await upload(ctx, { auth: tokens.service() });
    assert.strictEqual(res.status, 403);
    assert.strictEqual(res.body.error.code, 'FORBIDDEN');
  });
});

// ------------------------------------------------------------------ 400
test('400: no file at all', async () => {
  await withApp(async (ctx) => {
    const res = await upload(ctx, { file: null });
    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.body.error.code, 'VALIDATION_ERROR');
  });
});

test('400: file sent in the wrong field name, and an empty file', async () => {
  await withApp(async (ctx) => {
    assert.strictEqual((await upload(ctx, { fileField: 'document' })).status, 400);
    assert.strictEqual((await upload(ctx, { file: Buffer.alloc(0) })).status, 400);
  });
});

test('400: missing title, bad trainingId, bad dates, issueDate after expiryDate', async () => {
  await withApp(async (ctx) => {
    const cases = [
      { title: undefined }, { trainingId: 'not-a-uuid' }, { issueDate: '2026-02-30' },
      { expiryDate: '18/09/2027' }, { issueDate: '2027-01-01', expiryDate: '2026-01-01' },
      { title: 'x'.repeat(151) },
    ];
    for (const fields of cases) {
      const res = await upload(ctx, { fields });
      assert.strictEqual(res.status, 400, JSON.stringify(fields));
      assert.ok(Array.isArray(res.body.error.details));
    }
    assert.strictEqual(ctx.storage.puts.length, 0);
  });
});

test('400: the body is not multipart/form-data', async () => {
  await withApp(async (ctx) => {
    const res = await fetch(`${ctx.url}/api/certificates`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokens.employee()}`, 'Content-Type': 'multipart/form-data; boundary=abc' },
      body: 'this is not a multipart body',
    });
    assert.strictEqual(res.status, 400);
  });
});

// ------------------------------------------------------------------ 413 / 415
test('413: a file of 5 MB + 1 byte, and nothing is stored', async () => {
  await withApp(async (ctx) => {
    const file = Buffer.concat([Buffer.from('%PDF-'), Buffer.alloc(5 * 1024 * 1024 - 4)]);
    const res = await upload(ctx, { file });
    assert.strictEqual(res.status, 413);
    assert.strictEqual(res.body.error.code, 'PAYLOAD_TOO_LARGE');
    assert.strictEqual(ctx.storage.puts.length, 0);
  });
});

test('415: text, GIF and EXE bytes are refused even when the name and Content-Type say PDF', async () => {
  await withApp(async (ctx) => {
    const fakes = [Buffer.from('plain text pretending to be a pdf'), Buffer.from('GIF89a....'), Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03])];
    for (const file of fakes) {
      const res = await upload(ctx, { file, fileName: 'cert.pdf', fileType: 'application/pdf' });
      assert.strictEqual(res.status, 415);
      assert.strictEqual(res.body.error.code, 'UNSUPPORTED_MEDIA_TYPE');
    }
    assert.strictEqual(ctx.storage.puts.length, 0);
    assert.strictEqual(insertCalls(ctx).length, 0);
  });
});

// ------------------------------------------------------------------ 404 / 503
test('404: the training does not exist, and nothing is stored', async () => {
  await withApp(async (ctx) => {
    const res = await upload(ctx, { fields: { trainingId: '30000000-0000-4000-8000-000000000099' } });
    assert.strictEqual(res.status, 404);
    assert.strictEqual(ctx.storage.puts.length, 0);
    assert.strictEqual(insertCalls(ctx).length, 0);
  });
});

test('404: the user has no employee profile in S1', async () => {
  await withApp(async (ctx) => {
    ctx.upstream.meError = require('../../common/errors').notFound('No employee profile exists for this user');
    assert.strictEqual((await upload(ctx)).status, 404);
  });
});

test('503: S1 is down', async () => {
  await withApp(async (ctx) => {
    ctx.upstream.trainingError = upstreamUnavailable('S1 is unavailable');
    const res = await upload(ctx);
    assert.strictEqual(res.status, 503);
    assert.strictEqual(ctx.storage.puts.length, 0);
  });
});

// ------------------------------------------------------------------ 500 and safety
test('500: S3 fails -> generic message, no database row', async () => {
  await withApp(async (ctx) => {
    ctx.storage.fail = true;
    const res = await upload(ctx);
    assert.strictEqual(res.status, 500);
    assert.ok(!JSON.stringify(res.body).includes('S3 is down'));
    assert.strictEqual(insertCalls(ctx).length, 0);
  });
});

test('500: the database fails after the file was stored -> the stored file is deleted again', async () => {
  await withApp(async (ctx) => {
    ctx.pool.failInsert = true;
    const res = await upload(ctx);
    assert.strictEqual(res.status, 500);
    assert.ok(!JSON.stringify(res.body).includes('database is down'));
    assert.strictEqual(ctx.storage.puts.length, 1);
    assert.deepStrictEqual(ctx.storage.removed, [ctx.storage.puts[0].key]);
  });
});

test('logs never contain the token or the file content', async () => {
  await withApp(async (ctx) => {
    const t = tokens.employee();
    await upload(ctx, { auth: t });
    await upload(ctx, { file: Buffer.from('not a real file'), auth: t });
    const text = JSON.stringify(ctx.logs);
    assert.ok(ctx.logs.length > 0);
    assert.ok(!text.includes(t));
    assert.ok(!text.includes('SECRET-FILE-CONTENT'));
    assert.ok(!text.includes('cert.pdf'));
  });
});
