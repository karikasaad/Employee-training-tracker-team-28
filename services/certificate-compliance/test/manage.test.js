// EN: API tests for list (5.3), get one (5.4), edit (5.5) and delete (5.8): success, every error code,
//     the IDOR cases (an employee or another team's manager asking for a certificate that is not theirs)
//     and the audit rows. S1 is a fake that answers like the real one; the database pool is a fake that
//     records every SQL statement.
// Franco: API tests le list (5.3) w get (5.4) w edit (5.5) w delete (5.8): el nagah w kol error code w 7alat
//     el IDOR (mowazzaf aw manager team tany bey-talab certificate mesh beta3o) w satoor el audit.
//     S1 fake beyrod zay el 7a2i2i; pool el database fake beyesgel kol SQL.
const test = require('node:test');
const assert = require('node:assert');
const { upstreamUnavailable, IDS, TRAINING_ID, tokens, startApp } = require('../test-support/helpers');

const CERT_ID = '50000000-0000-4000-8000-000000000001';
const UNKNOWN_ID = '50000000-0000-4000-8000-000000000099';

async function withApp(fn) {
  const ctx = await startApp();
  try { await fn(ctx); } finally { await ctx.close(); }
}

// EN: a database row as Postgres returns it. Owner = Ahmed (Operations team, manager Mona).
// Franco: satr database zay ma Postgres beyrga3o. El sa7eb = Ahmed (team Operations, manager Mona).
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

const GOOD_EDIT = {
  title: 'Fire Safety Certificate v2', issuer: 'New Institute', certificateNumber: 'FS-2002',
  issueDate: '2026-10-01', expiryDate: '2027-10-01',
};

// =================================================================== 5.3 list
test('5.3 200: the manager of the team lists its certificates (all employees of that team)', async () => {
  await withApp(async (ctx) => {
    ctx.pool.selectRows = [row(), row({ id: '50000000-0000-4000-8000-000000000002', employee_id: IDS.SARA })];
    const res = await call(ctx, 'GET', `/api/certificates?teamId=${IDS.OPS}`, tokens.mona());
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.length, 2);
    assert.ok(res.body.every((c) => !('s3Key' in c) && !('fileHash' in c)));
    const select = ctx.pool.calls.find((c) => /^\s*SELECT/i.test(c.sql));
    assert.deepStrictEqual(select.params, [[IDS.MONA, IDS.AHMED, IDS.SARA]]);
    assert.match(select.sql, /deleted_at IS NULL/);
  });
});

test('5.3 200: reviewStatus filter is a SQL parameter', async () => {
  await withApp(async (ctx) => {
    const res = await call(ctx, 'GET', `/api/certificates?teamId=${IDS.OPS}&reviewStatus=Pending`, tokens.mona());
    assert.strictEqual(res.status, 200);
    const select = ctx.pool.calls.find((c) => /^\s*SELECT/i.test(c.sql));
    assert.deepStrictEqual(select.params, [[IDS.MONA, IDS.AHMED, IDS.SARA], 'Pending']);
  });
});

test('5.3 400: teamId missing or not a UUID, reviewStatus not allowed (also lower case)', async () => {
  await withApp(async (ctx) => {
    for (const q of ['', '?teamId=abc', `?teamId=${IDS.OPS}&reviewStatus=Done`, `?teamId=${IDS.OPS}&reviewStatus=pending`]) {
      const res = await call(ctx, 'GET', `/api/certificates${q}`, tokens.mona());
      assert.strictEqual(res.status, 400, q);
    }
    assert.strictEqual(ctx.pool.calls.length, 0);
  });
});

test('5.3 401 no token / 403 Employee / 403 Service token / 403 manager of another team / 404 unknown team', async () => {
  await withApp(async (ctx) => {
    const url = `/api/certificates?teamId=${IDS.OPS}`;
    assert.strictEqual((await call(ctx, 'GET', url, null)).status, 401);
    assert.strictEqual((await call(ctx, 'GET', url, tokens.employee())).status, 403);
    assert.strictEqual((await call(ctx, 'GET', url, tokens.service())).status, 403);
    assert.strictEqual((await call(ctx, 'GET', url, tokens.omar())).status, 403); // Omar manages Laboratory, not Operations
    assert.strictEqual((await call(ctx, 'GET', '/api/certificates?teamId=10000000-0000-4000-8000-000000000099', tokens.mona())).status, 404);
    assert.strictEqual(ctx.pool.calls.length, 0); // EN: no certificate was ever read / Franco: mafeesh certificate etqara
  });
});

test('5.3 503: S1 is down', async () => {
  await withApp(async (ctx) => {
    ctx.upstream.teamsError = upstreamUnavailable('S1 is unavailable');
    assert.strictEqual((await call(ctx, 'GET', `/api/certificates?teamId=${IDS.OPS}`, tokens.mona())).status, 503);
  });
});

// =================================================================== 5.4 get one
test('5.4 200: the owner and the manager of the owner\'s team can read it', async () => {
  await withApp(async (ctx) => {
    ctx.pool.selectRows = [row()];
    const owner = await call(ctx, 'GET', `/api/certificates/${CERT_ID}`, tokens.employee());
    const manager = await call(ctx, 'GET', `/api/certificates/${CERT_ID}`, tokens.mona());
    assert.strictEqual(owner.status, 200);
    assert.strictEqual(owner.body.id, CERT_ID);
    assert.strictEqual(owner.body.validity, 'Valid');
    assert.ok(!('s3Key' in owner.body) && !('fileHash' in owner.body));
    assert.strictEqual(manager.status, 200);
    const select = ctx.pool.calls.find((c) => /^\s*SELECT/i.test(c.sql));
    assert.deepStrictEqual(select.params, [CERT_ID]);
  });
});

test('5.4 403 (IDOR): another employee, and the manager of ANOTHER team, cannot read it', async () => {
  await withApp(async (ctx) => {
    ctx.pool.selectRows = [row()];
    assert.strictEqual((await call(ctx, 'GET', `/api/certificates/${CERT_ID}`, tokens.sara())).status, 403);
    assert.strictEqual((await call(ctx, 'GET', `/api/certificates/${CERT_ID}`, tokens.omar())).status, 403);
  });
});

test('5.4 400 bad id / 401 no token / 403 Service token / 404 unknown or deleted id', async () => {
  await withApp(async (ctx) => {
    assert.strictEqual((await call(ctx, 'GET', '/api/certificates/not-a-uuid')).status, 400);
    assert.strictEqual((await call(ctx, 'GET', `/api/certificates/${CERT_ID}`, null)).status, 401);
    assert.strictEqual((await call(ctx, 'GET', `/api/certificates/${CERT_ID}`, tokens.service())).status, 403);
    ctx.pool.selectRows = [];
    const res = await call(ctx, 'GET', `/api/certificates/${UNKNOWN_ID}`);
    assert.strictEqual(res.status, 404);
    assert.strictEqual(res.body.error.code, 'NOT_FOUND');
  });
});

// =================================================================== 5.5 edit
test('5.5 200: the owner edits a Pending certificate; SQL is parameterised, audit row (update, success)', async () => {
  await withApp(async (ctx) => {
    ctx.pool.selectRows = [row()];
    ctx.pool.updateRows = [row({ title: GOOD_EDIT.title, issuer: GOOD_EDIT.issuer, certificate_number: 'FS-2002', issue_date: '2026-10-01', expiry_date: '2027-10-01' })];
    const res = await call(ctx, 'PUT', `/api/certificates/${CERT_ID}`, tokens.employee(), GOOD_EDIT);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.title, GOOD_EDIT.title);
    assert.strictEqual(res.body.expiryDate, '2027-10-01');
    const [update] = updateCalls(ctx);
    assert.deepStrictEqual(update.params, [CERT_ID, GOOD_EDIT.title, GOOD_EDIT.issuer, 'FS-2002', '2026-10-01', '2027-10-01', 'Pending']);
    assert.match(update.sql, /review_status = \$7/);
    const [audit] = auditRows(ctx);
    assert.deepStrictEqual([audit.params[0], audit.params[1], audit.params[2], audit.params[4]], [IDS.AHMED, 'update', CERT_ID, 'success']);
  });
});

test('5.5: owner, status and employee cannot be changed through the body', async () => {
  await withApp(async (ctx) => {
    ctx.pool.selectRows = [row()];
    ctx.pool.updateRows = [row()];
    await call(ctx, 'PUT', `/api/certificates/${CERT_ID}`, tokens.employee(),
      { ...GOOD_EDIT, employeeId: IDS.SARA, reviewStatus: 'Verified', s3Key: 'x', trainingId: IDS.OPS });
    const [update] = updateCalls(ctx);
    assert.ok(!update.params.includes(IDS.SARA) && !update.params.includes('Verified') && !update.params.includes('x'));
    assert.ok(!/employee_id|s3_key|training_id/.test(update.sql.split('WHERE')[0]));
  });
});

test('5.5 409: the certificate is not Pending any more (no audit row)', async () => {
  await withApp(async (ctx) => {
    ctx.pool.selectRows = [row({ review_status: 'Verified' })];
    ctx.pool.updateRows = []; // EN: the UPDATE found no Pending row / Franco: el UPDATE ma la2ash satr Pending
    const res = await call(ctx, 'PUT', `/api/certificates/${CERT_ID}`, tokens.employee(), GOOD_EDIT);
    assert.strictEqual(res.status, 409);
    assert.strictEqual(res.body.error.code, 'CONFLICT');
    assert.strictEqual(auditRows(ctx).length, 0);
  });
});

test('5.5 403 (IDOR): another employee and the owner\'s manager cannot edit; a "denied" audit row is written', async () => {
  await withApp(async (ctx) => {
    ctx.pool.selectRows = [row()];
    assert.strictEqual((await call(ctx, 'PUT', `/api/certificates/${CERT_ID}`, tokens.sara(), GOOD_EDIT)).status, 403);
    assert.strictEqual((await call(ctx, 'PUT', `/api/certificates/${CERT_ID}`, tokens.mona(), GOOD_EDIT)).status, 403);
    assert.strictEqual((await call(ctx, 'PUT', `/api/certificates/${CERT_ID}`, tokens.omar(), GOOD_EDIT)).status, 403);
    assert.strictEqual(updateCalls(ctx).length, 0);
    const audits = auditRows(ctx);
    assert.strictEqual(audits.length, 3);
    assert.ok(audits.every((a) => a.params[1] === 'update' && a.params[4] === 'denied' && a.params[2] === CERT_ID));
  });
});

test('5.5 400: bad id, missing title, bad date, issueDate after expiryDate; nothing is updated', async () => {
  await withApp(async (ctx) => {
    ctx.pool.selectRows = [row()];
    assert.strictEqual((await call(ctx, 'PUT', '/api/certificates/nope', tokens.employee(), GOOD_EDIT)).status, 400);
    for (const bad of [{ title: undefined }, { issueDate: '2026-02-30' }, { issueDate: '2028-01-01' }, { title: 'x'.repeat(151) }]) {
      const res = await call(ctx, 'PUT', `/api/certificates/${CERT_ID}`, tokens.employee(), { ...GOOD_EDIT, ...bad });
      assert.strictEqual(res.status, 400, JSON.stringify(bad));
    }
    assert.strictEqual((await call(ctx, 'PUT', `/api/certificates/${CERT_ID}`, tokens.employee(), {})).status, 400);
    assert.strictEqual(updateCalls(ctx).length, 0);
  });
});

test('5.5 401 no token / 403 Service token / 404 unknown id', async () => {
  await withApp(async (ctx) => {
    assert.strictEqual((await call(ctx, 'PUT', `/api/certificates/${CERT_ID}`, null, GOOD_EDIT)).status, 401);
    assert.strictEqual((await call(ctx, 'PUT', `/api/certificates/${CERT_ID}`, tokens.service(), GOOD_EDIT)).status, 403);
    ctx.pool.selectRows = [];
    assert.strictEqual((await call(ctx, 'PUT', `/api/certificates/${UNKNOWN_ID}`, tokens.employee(), GOOD_EDIT)).status, 404);
  });
});

// =================================================================== 5.8 delete
test('5.8 204: the owner soft-deletes a Pending certificate; audit row (delete, success)', async () => {
  await withApp(async (ctx) => {
    ctx.pool.selectRows = [row()];
    ctx.pool.updateRows = [{ id: CERT_ID }];
    const res = await call(ctx, 'DELETE', `/api/certificates/${CERT_ID}`, tokens.employee());
    assert.strictEqual(res.status, 204);
    const [update] = updateCalls(ctx);
    assert.match(update.sql, /SET deleted_at = now\(\)/);
    assert.ok(!/DELETE FROM/i.test(ctx.pool.calls.map((c) => c.sql).join(' ')));
    const [audit] = auditRows(ctx);
    assert.deepStrictEqual([audit.params[0], audit.params[1], audit.params[2], audit.params[4]], [IDS.AHMED, 'delete', CERT_ID, 'success']);
  });
});

test('5.8 204: the manager of the owner\'s team can delete even a Verified certificate; actor is the manager', async () => {
  await withApp(async (ctx) => {
    ctx.pool.selectRows = [row({ review_status: 'Verified' })];
    ctx.pool.updateRows = [{ id: CERT_ID }];
    const res = await call(ctx, 'DELETE', `/api/certificates/${CERT_ID}`, tokens.mona());
    assert.strictEqual(res.status, 204);
    assert.strictEqual(auditRows(ctx)[0].params[0], IDS.MONA);
  });
});

test('5.8 403: the owner cannot delete a Verified certificate; "denied" audit row, no UPDATE', async () => {
  await withApp(async (ctx) => {
    ctx.pool.selectRows = [row({ review_status: 'Verified' })];
    const res = await call(ctx, 'DELETE', `/api/certificates/${CERT_ID}`, tokens.employee());
    assert.strictEqual(res.status, 403);
    assert.strictEqual(updateCalls(ctx).length, 0);
    assert.strictEqual(auditRows(ctx)[0].params[4], 'denied');
  });
});

test('5.8 403 (IDOR): another employee and another team\'s manager cannot delete', async () => {
  await withApp(async (ctx) => {
    ctx.pool.selectRows = [row()];
    assert.strictEqual((await call(ctx, 'DELETE', `/api/certificates/${CERT_ID}`, tokens.sara())).status, 403);
    assert.strictEqual((await call(ctx, 'DELETE', `/api/certificates/${CERT_ID}`, tokens.omar())).status, 403);
    assert.strictEqual(updateCalls(ctx).length, 0);
    assert.ok(auditRows(ctx).every((a) => a.params[1] === 'delete' && a.params[4] === 'denied'));
  });
});

test('5.8 400 bad id / 401 no token / 403 Service token / 404 unknown id, and 404 if it was deleted a moment ago', async () => {
  await withApp(async (ctx) => {
    assert.strictEqual((await call(ctx, 'DELETE', '/api/certificates/nope')).status, 400);
    assert.strictEqual((await call(ctx, 'DELETE', `/api/certificates/${CERT_ID}`, null)).status, 401);
    assert.strictEqual((await call(ctx, 'DELETE', `/api/certificates/${CERT_ID}`, tokens.service())).status, 403);
    ctx.pool.selectRows = [];
    assert.strictEqual((await call(ctx, 'DELETE', `/api/certificates/${UNKNOWN_ID}`)).status, 404);
    ctx.pool.selectRows = [row()];
    ctx.pool.updateRows = []; // EN: someone deleted it between our SELECT and UPDATE / Franco: had mas7o benna el SELECT w el UPDATE
    assert.strictEqual((await call(ctx, 'DELETE', `/api/certificates/${CERT_ID}`)).status, 404);
  });
});

// =================================================================== safety
test('5.3 to 5.8: the logs never contain the token, and the S3 key never leaves the service', async () => {
  await withApp(async (ctx) => {
    const t = tokens.employee();
    ctx.pool.selectRows = [row()];
    const res = await call(ctx, 'GET', `/api/certificates/${CERT_ID}`, t);
    assert.ok(!JSON.stringify(res.body).includes('secret-key'));
    assert.ok(ctx.logs.length > 0);
    assert.ok(!JSON.stringify(ctx.logs).includes(t));
  });
});
