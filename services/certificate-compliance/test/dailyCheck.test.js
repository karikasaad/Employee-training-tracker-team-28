// EN: tests for the DAILY CHECK (5.10): the rules (pure functions), the mailer (SendGrid), and the endpoint
//     (success, idempotence, resolving, reminders, and every error code). SendGrid and S1 are fakes.
// Franco: tests lel DAILY CHECK (5.10): el rules (functions nadeefa) w el mailer (SendGrid) w el endpoint
//     (el nagah w en el job momken yeshtaghal marteen w el resolve w el tazkeer w kol error code). SendGrid w S1 fakes.
const test = require('node:test');
const assert = require('node:assert');
const { desiredFlags, planFlagChanges, remindersDue } = require('../src/compliance');
const { createMailer, isRealKey } = require('../src/mailer');
const { IDS, tokens, startApp, upstreamUnavailable } = require('../test-support/helpers');
const { upstreamError } = require('../../common/errors');

const TODAY = '2026-11-23';
const T_FIRE = '30000000-0000-4000-8000-000000000001';
const T_SAFETY = '30000000-0000-4000-8000-000000000003';
const people = [{ id: IDS.AHMED, name: 'Ahmed Ali' }, { id: IDS.SARA, name: 'Sara Samir' }];

function cert(id, employee, training, status, expiry) {
  return { id, employee_id: employee, training_id: training, review_status: status, expiry_date: expiry };
}
const done = (employeeId, trainingId) => ({ employeeId, trainingId, trainingName: 'Fire Safety', requiresCertificate: true });
function flagRow(over = {}) {
  return {
    id: 'f0000000-0000-4000-8000-000000000001', certificate_id: null, employee_id: IDS.AHMED, training_id: T_FIRE,
    flag_type: 'Missing', raised_at: new Date('2026-11-20T01:00:00Z'), notified_at: null, ...over,
  };
}

// =================================================================== rules
test('desiredFlags: Missing, Expired and ExpiringSoon (Pending certificates do not count)', () => {
  const flags = desiredFlags({
    employees: people, today: TODAY,
    assignments: [done(IDS.AHMED, T_FIRE), done(IDS.SARA, T_FIRE)],
    certRows: [
      cert('c1', IDS.SARA, T_FIRE, 'Verified', '2026-01-01'), // expired
      cert('c2', IDS.AHMED, T_SAFETY, 'Verified', '2026-12-02'), // expires in 9 days
      cert('c3', IDS.AHMED, T_FIRE, 'Pending', '2030-01-01'), // pending: does not help
    ],
  });
  const brief = flags.map((f) => [f.employeeId, f.trainingId, f.flagType, f.certificateId]);
  assert.deepStrictEqual(brief.sort(), [
    [IDS.AHMED, T_FIRE, 'Missing', null],
    [IDS.AHMED, T_SAFETY, 'ExpiringSoon', 'c2'],
    [IDS.SARA, T_FIRE, 'Expired', 'c1'],
  ].sort());
});

test('desiredFlags: a certificate that expires in 31 days or already expired never gives ExpiringSoon', () => {
  const flags = desiredFlags({
    employees: people, today: TODAY, assignments: [],
    certRows: [cert('c1', IDS.AHMED, T_FIRE, 'Verified', '2026-12-24'), cert('c2', IDS.SARA, T_FIRE, 'Verified', '2026-11-22')],
  });
  assert.deepStrictEqual(flags, []);
});

test('planFlagChanges: raises the new, keeps the open, resolves the ones no longer true', () => {
  const desired = [
    { employeeId: IDS.AHMED, trainingId: T_FIRE, flagType: 'Missing', certificateId: null },
    { employeeId: IDS.SARA, trainingId: T_FIRE, flagType: 'Expired', certificateId: 'c1' },
  ];
  const open = [flagRow({ id: 'keep' }), flagRow({ id: 'gone', employee_id: IDS.SARA, flag_type: 'Missing' })];
  const plan = planFlagChanges(desired, open);
  assert.deepStrictEqual(plan.toRaise.map((f) => f.flagType), ['Expired']);
  assert.deepStrictEqual(plan.toResolve, ['gone']); // EN: Missing becomes Expired: old one resolved / Franco: Missing b2a Expired
});

test('planFlagChanges: running again with the same open flags changes nothing (idempotent)', () => {
  const plan = planFlagChanges(
    [{ employeeId: IDS.AHMED, trainingId: T_FIRE, flagType: 'Missing', certificateId: null }],
    [flagRow()],
  );
  assert.deepStrictEqual(plan, { toRaise: [], toResolve: [] });
});

test('remindersDue: Missing/Expired only once; ExpiringSoon on day 30, 7 and 0 and not twice on one day', () => {
  const certRows = [cert('c30', IDS.AHMED, T_FIRE, 'Verified', '2026-12-23'), cert('c7', IDS.AHMED, T_SAFETY, 'Verified', '2026-11-30'),
    cert('c0', IDS.SARA, T_FIRE, 'Verified', TODAY), cert('c10', IDS.SARA, T_SAFETY, 'Verified', '2026-12-03')];
  const soon = (id, cid, over = {}) => flagRow({ id, certificate_id: cid, flag_type: 'ExpiringSoon', ...over });
  const openRows = [
    flagRow({ id: 'new-missing' }),
    flagRow({ id: 'old-missing', training_id: T_SAFETY, notified_at: new Date('2026-11-21T10:00:00Z') }),
    soon('d30', 'c30'), soon('d7', 'c7'), soon('d0', 'c0'), soon('d10', 'c10'),
    soon('d7-today', 'c7', { id: 'd7-today', notified_at: new Date('2026-11-23T01:00:00Z') }),
  ];
  const ids = remindersDue({ openRows, certRows, today: TODAY }).map((f) => f.id);
  assert.deepStrictEqual(ids.sort(), ['d0', 'd30', 'd7', 'new-missing'].sort());
});

// =================================================================== mailer
const quiet = () => { const logs = []; return { logs, warn: (e, f) => logs.push({ e, f }), error: (e, f) => logs.push({ e, f }), info: (e, f) => logs.push({ e, f }) }; };

test('isRealKey: only SG. keys; the local placeholder and empty are not keys', () => {
  assert.strictEqual(isRealKey('SG.abc.def'), true);
  assert.strictEqual(isRealKey('REPLACE_ME_WITH_REAL_SENDGRID_KEY'), false);
  assert.strictEqual(isRealKey(''), false);
  assert.strictEqual(isRealKey(undefined), false);
});

test('mailer: no key -> skipped, "email skipped" is logged, SendGrid is not called', async () => {
  const logger = quiet();
  let called = false;
  const mailer = createMailer({ logger, getKey: async () => null, fetchImpl: async () => { called = true; } });
  assert.strictEqual(await mailer.send({ to: 'a@b.c', subject: 's', text: 't' }), 'skipped');
  assert.strictEqual(called, false);
  assert.ok(logger.logs.some((l) => l.e === 'email_skipped' && /email skipped/.test(l.f.message)));
});

test('mailer: with a key it posts to SendGrid with a Bearer header; the key is never logged', async () => {
  const logger = quiet();
  let seen;
  const mailer = createMailer({
    logger, fromEmail: 'noreply@ett.test', getKey: async () => 'SG.supersecretkey',
    fetchImpl: async (url, opts) => { seen = { url, opts }; return { ok: true, status: 202 }; },
  });
  assert.strictEqual(await mailer.send({ to: 'mona@example.com', subject: 'Hi', text: 'Body' }), 'sent');
  assert.strictEqual(seen.url, 'https://api.sendgrid.com/v3/mail/send');
  assert.strictEqual(seen.opts.headers.Authorization, 'Bearer SG.supersecretkey');
  const body = JSON.parse(seen.opts.body);
  assert.strictEqual(body.personalizations[0].to[0].email, 'mona@example.com');
  assert.strictEqual(body.from.email, 'noreply@ett.test');
  assert.ok(!JSON.stringify(logger.logs).includes('supersecretkey'));
});

test('mailer: SendGrid refuses or is down -> failed, and the key is still not logged', async () => {
  const logger = quiet();
  const refused = createMailer({ logger, getKey: async () => 'SG.supersecretkey', fetchImpl: async () => ({ ok: false, status: 401 }) });
  const down = createMailer({ logger, getKey: async () => 'SG.supersecretkey', fetchImpl: async () => { throw new Error('connect ECONNREFUSED'); } });
  assert.strictEqual(await refused.send({ to: 'a@b.c', subject: 's', text: 't' }), 'failed');
  assert.strictEqual(await down.send({ to: 'a@b.c', subject: 's', text: 't' }), 'failed');
  assert.ok(!JSON.stringify(logger.logs).includes('supersecretkey'));
});

// =================================================================== the endpoint
async function withApp(fn) {
  const ctx = await startApp();
  try { await fn(ctx); } finally { await ctx.close(); }
}
const run = (ctx, auth = tokens.service()) => fetch(`${ctx.url}/api/compliance/run-check`, {
  method: 'POST', headers: auth ? { Authorization: `Bearer ${auth}` } : {},
}).then(async (res) => ({ status: res.status, body: await res.json() }));
const callsMatching = (ctx, re) => ctx.pool.calls.filter((c) => re.test(c.sql));

test('200: a new Missing flag is raised and the manager gets ONE e-mail; the flags are marked as notified', async () => {
  await withApp(async (ctx) => {
    ctx.upstream.assignments = [done(IDS.AHMED, T_FIRE)];
    const newFlag = flagRow({ id: 'f0000000-0000-4000-8000-0000000000aa' });
    ctx.pool.flagReads = [[], [newFlag]]; // EN: before the changes, then after / Franco: abl el ta3deelat, ba3dein
    const res = await run(ctx);
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(res.body, { flagsRaised: 1, flagsResolved: 0, remindersSent: 1, remindersSkipped: 0 });
    const [insert] = callsMatching(ctx, /INSERT INTO compliance_flags/);
    assert.deepStrictEqual(insert.params, [null, IDS.AHMED, T_FIRE, 'Missing']);
    assert.match(insert.sql, /ON CONFLICT/);
    assert.strictEqual(ctx.mailer.sent.length, 1);
    assert.strictEqual(ctx.mailer.sent[0].to, 'mona@example.com');
    assert.match(ctx.mailer.sent[0].text, /Ahmed Ali: certificate missing for Fire Safety/);
    assert.deepStrictEqual(callsMatching(ctx, /SET notified_at/)[0].params, [[newFlag.id]]);
  });
});

test('200: Service token forwarded to S1; each team is read once', async () => {
  await withApp(async (ctx) => {
    await run(ctx);
    const forTeams = ctx.upstream.calls.filter((c) => c.name === 'getTeamEmployees').map((c) => c.teamId);
    assert.deepStrictEqual(forTeams, [IDS.OPS, IDS.LAB]);
    assert.ok(ctx.upstream.calls.every((c) => c.ctx.token.split('.').length === 3));
  });
});

test('200 idempotent: running again with the same open flag raises nothing and sends nothing', async () => {
  await withApp(async (ctx) => {
    ctx.upstream.assignments = [done(IDS.AHMED, T_FIRE)];
    const already = flagRow({ notified_at: new Date('2026-11-22T10:00:00Z') });
    ctx.pool.flagReads = [[already], [already]];
    const res = await run(ctx);
    assert.deepStrictEqual(res.body, { flagsRaised: 0, flagsResolved: 0, remindersSent: 0, remindersSkipped: 0 });
    assert.strictEqual(callsMatching(ctx, /INSERT INTO compliance_flags/).length, 0);
    assert.strictEqual(ctx.mailer.sent.length, 0);
  });
});

test('200: a flag that is no longer true is resolved (a Verified certificate arrived)', async () => {
  await withApp(async (ctx) => {
    ctx.upstream.assignments = [done(IDS.AHMED, T_FIRE)];
    ctx.pool.selectRows = [cert('c1', IDS.AHMED, T_FIRE, 'Verified', '2027-06-01')];
    ctx.pool.flagReads = [[flagRow({ id: 'f-old' })], []];
    const res = await run(ctx);
    assert.strictEqual(res.body.flagsResolved, 1);
    assert.deepStrictEqual(callsMatching(ctx, /SET resolved_at/)[0].params, ['f-old']);
  });
});

test('200: ExpiringSoon reminder on day 7 is sent; on day 29 it is not', async () => {
  await withApp(async (ctx) => {
    ctx.pool.selectRows = [cert('c7', IDS.AHMED, T_SAFETY, 'Verified', '2026-11-30')];
    const open = flagRow({ id: 'f7', certificate_id: 'c7', training_id: T_SAFETY, flag_type: 'ExpiringSoon', notified_at: new Date('2026-11-22T10:00:00Z') });
    ctx.pool.flagReads = [[open], [open]];
    const res = await run(ctx);
    assert.strictEqual(res.body.remindersSent, 1);
    assert.match(ctx.mailer.sent[0].text, /certificate expiring soon.*\(expires 2026-11-30\)/);
  });
  await withApp(async (ctx) => {
    ctx.pool.selectRows = [cert('c29', IDS.AHMED, T_SAFETY, 'Verified', '2026-12-22')];
    const open = flagRow({ id: 'f29', certificate_id: 'c29', training_id: T_SAFETY, flag_type: 'ExpiringSoon', notified_at: null });
    ctx.pool.flagReads = [[open], [open]];
    assert.strictEqual((await run(ctx)).body.remindersSent, 0);
  });
});

test('200: no SendGrid key -> reminders skipped and NOT marked as notified (tried again next run)', async () => {
  await withApp(async (ctx) => {
    ctx.mailer.result = 'skipped';
    ctx.upstream.assignments = [done(IDS.AHMED, T_FIRE)];
    ctx.pool.flagReads = [[], [flagRow()]];
    const res = await run(ctx);
    assert.deepStrictEqual([res.body.remindersSent, res.body.remindersSkipped], [0, 1]);
    assert.strictEqual(callsMatching(ctx, /SET notified_at/).length, 0);
  });
});

test('401 no token / 403 Employee / 403 Manager: only the Service token may run the check; nothing is read', async () => {
  await withApp(async (ctx) => {
    assert.strictEqual((await run(ctx, null)).status, 401);
    assert.strictEqual((await run(ctx, tokens.employee())).status, 403);
    assert.strictEqual((await run(ctx, tokens.mona())).status, 403);
    assert.strictEqual(ctx.pool.calls.length, 0);
    assert.strictEqual(ctx.upstream.calls.length, 0);
  });
});

test('503 S1 is down / 502 S1 fails: an error body, and nothing is e-mailed', async () => {
  await withApp(async (ctx) => {
    ctx.upstream.teamsError = upstreamUnavailable('S1 is unavailable');
    assert.strictEqual((await run(ctx)).status, 503);
    ctx.upstream.teamsError = null;
    ctx.upstream.assignmentsError = upstreamError('S1 failed');
    assert.strictEqual((await run(ctx)).status, 502);
    assert.strictEqual(ctx.mailer.sent.length, 0);
  });
});

test('logs never contain a token or an e-mail address', async () => {
  await withApp(async (ctx) => {
    const t = tokens.service();
    ctx.upstream.assignments = [done(IDS.AHMED, T_FIRE)];
    ctx.pool.flagReads = [[], [flagRow()]];
    await run(ctx, t);
    const text = JSON.stringify(ctx.logs);
    assert.ok(ctx.logs.length > 0);
    assert.ok(!text.includes(t));
    assert.ok(!text.includes('@example.com'));
  });
});
