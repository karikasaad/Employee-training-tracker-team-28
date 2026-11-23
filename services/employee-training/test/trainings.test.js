// EN: API tests for branch kerolus/s1-trainings (contract 4.6, 4.6b, 4.7, 4.8): success, 400, 401, 403,
//     404, 409. Real app + real Postgres (seed) + real auth module.
// Franco: API tests le branch kerolus/s1-trainings: success, 400, 401, 403, 404, 409.
//     App 7a2i2i + Postgres 7a2i2eya (el seed) + auth module 7a2i2i.
'use strict';
const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { IDS, skipDb, resetDatabase, closeDb, makeApp, call, tokens } = require('../test-support/helpers');

const FIRE_SAFETY = '30000000-0000-4000-8000-000000000001'; // created by Mona (seed)
const DATA_PROTECTION = '30000000-0000-4000-8000-000000000003'; // created by Omar (seed)
const UNKNOWN_TRAINING = '30000000-0000-4000-8000-000000000099';

describe('S1 trainings', { skip: skipDb }, () => {
  let app;
  before(async () => { await resetDatabase(); app = makeApp(); });
  after(closeDb);

  // ------------------------------------------------------------ 4.6 POST /api/trainings
  test('4.6 create: manager -> 201 with the Training shape, createdBy = caller', async () => {
    const res = await call(app, 'POST', '/api/trainings', {
      token: tokens.mona(),
      body: { name: '  Working at Height  ', category: 'Safety', requiresCertificate: true, validityMonths: 24 },
    });
    assert.equal(res.status, 201);
    assert.equal(res.body.name, 'Working at Height'); // EN: spaces trimmed / Franco: el masafat etshalet
    assert.equal(res.body.category, 'Safety');
    assert.equal(res.body.requiresCertificate, true);
    assert.equal(res.body.validityMonths, 24);
    assert.equal(res.body.createdBy, IDS.MONA);
    assert.match(res.body.id, /^[0-9a-f-]{36}$/);
    assert.ok(!Number.isNaN(Date.parse(res.body.createdAt)));
  });

  test('4.6 create: defaults requiresCertificate=false and validityMonths=null', async () => {
    const res = await call(app, 'POST', '/api/trainings', { token: tokens.omar(), body: { name: 'Lab Orientation', category: 'Laboratory' } });
    assert.equal(res.status, 201);
    assert.equal(res.body.requiresCertificate, false);
    assert.equal(res.body.validityMonths, null);
  });

  test('4.6 create: employee -> 403, no token -> 401', async () => {
    const body = { name: 'Sneaky', category: 'Safety' };
    const res = await call(app, 'POST', '/api/trainings', { token: tokens.ahmed(), body });
    assert.equal(res.status, 403);
    assert.equal(res.body.error.code, 'FORBIDDEN');
    assert.equal((await call(app, 'POST', '/api/trainings', { body })).status, 401);
  });

  test('4.6 create: invalid input -> 400 with the field name', async () => {
    const bad = [
      [{ category: 'Safety' }, 'name'],
      [{ name: '', category: 'Safety' }, 'name'],
      [{ name: 'x'.repeat(151), category: 'Safety' }, 'name'],
      [{ name: 'A', category: 'c'.repeat(51) }, 'category'],
      [{ name: 'A', category: 'Safety', requiresCertificate: 'yes' }, 'requiresCertificate'],
      [{ name: 'A', category: 'Safety', validityMonths: 0 }, 'validityMonths'],
      [{ name: 'A', category: 'Safety', validityMonths: 121 }, 'validityMonths'],
      [{ name: 'A', category: 'Safety', validityMonths: 1.5 }, 'validityMonths'],
      [{ name: 42, category: 'Safety' }, 'name'],
    ];
    for (const [body, field] of bad) {
      const res = await call(app, 'POST', '/api/trainings', { token: tokens.mona(), body });
      assert.equal(res.status, 400, JSON.stringify(body));
      assert.equal(res.body.error.details[0].field, field, JSON.stringify(body));
    }
  });

  test('4.6 create: body that is not a JSON object, or broken JSON -> 400', async () => {
    assert.equal((await call(app, 'POST', '/api/trainings', { token: tokens.mona(), body: [1, 2] })).status, 400);
    assert.equal((await call(app, 'POST', '/api/trainings', { token: tokens.mona(), body: '{"name": ' })).status, 400);
  });

  test('4.6 create: a name that already exists -> 409', async () => {
    const res = await call(app, 'POST', '/api/trainings', { token: tokens.mona(), body: { name: 'Fire Safety', category: 'Safety' } });
    assert.equal(res.status, 409);
    assert.equal(res.body.error.code, 'CONFLICT');
  });

  // ------------------------------------------------------------ 4.7 GET /api/trainings
  test('4.7 list: employee and manager -> 200, ordered by name', async () => {
    const res = await call(app, 'GET', '/api/trainings', { token: tokens.ahmed() });
    assert.equal(res.status, 200);
    const names = res.body.map((t) => t.name);
    assert.deepEqual(names, [...names].sort((a, b) => a.localeCompare(b, 'en')));
    assert.ok(names.includes('Fire Safety'));
    assert.equal((await call(app, 'GET', '/api/trainings', { token: tokens.mona() })).status, 200);
  });

  test('4.7 list: ?category= filters by exact category', async () => {
    const res = await call(app, 'GET', '/api/trainings?category=Compliance', { token: tokens.mona() });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.map((t) => t.name), ['Code of Conduct', 'Data Protection Basics']);
  });

  test('4.7 list: SQL-injection text in ?category= is harmless (200, empty list, no 500)', async () => {
    const res = await call(app, 'GET', `/api/trainings?category=${encodeURIComponent("Safety' OR '1'='1")}`, { token: tokens.mona() });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, []);
  });

  test('4.7 list: bad ?category= -> 400; no token -> 401; Service token -> 403', async () => {
    assert.equal((await call(app, 'GET', `/api/trainings?category=${'x'.repeat(51)}`, { token: tokens.mona() })).status, 400);
    assert.equal((await call(app, 'GET', '/api/trainings?category=a&category=b', { token: tokens.mona() })).status, 400);
    assert.equal((await call(app, 'GET', '/api/trainings')).status, 401);
    assert.equal((await call(app, 'GET', '/api/trainings', { token: tokens.service() })).status, 403);
  });

  // ------------------------------------------------------------ 4.8 GET /api/trainings/{id}
  test('4.8 get by id: employee, manager and Service token -> 200', async () => {
    for (const tok of [tokens.ahmed(), tokens.omar(), tokens.service()]) {
      const res = await call(app, 'GET', `/api/trainings/${FIRE_SAFETY}`, { token: tok });
      assert.equal(res.status, 200);
      assert.equal(res.body.requiresCertificate, true);
      assert.equal(res.body.validityMonths, 12);
    }
  });

  test('4.8 get by id: unknown -> 404, malformed -> 400, no token -> 401', async () => {
    assert.equal((await call(app, 'GET', `/api/trainings/${UNKNOWN_TRAINING}`, { token: tokens.ahmed() })).status, 404);
    assert.equal((await call(app, 'GET', '/api/trainings/123', { token: tokens.ahmed() })).status, 400);
    assert.equal((await call(app, 'GET', `/api/trainings/${FIRE_SAFETY}`)).status, 401);
  });

  // ------------------------------------------------------------ 4.6b PUT /api/trainings/{id}
  test('4.6b edit: the manager who created it -> 200 with the new values', async () => {
    const res = await call(app, 'PUT', `/api/trainings/${FIRE_SAFETY}`, {
      token: tokens.mona(),
      body: { name: 'Fire Safety', category: 'Safety', requiresCertificate: true, validityMonths: 24 },
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.validityMonths, 24);
    assert.equal(res.body.createdBy, IDS.MONA); // EN: creator never changes / Franco: el creator mabyetghayyarsh
    const again = await call(app, 'GET', `/api/trainings/${FIRE_SAFETY}`, { token: tokens.ahmed() });
    assert.equal(again.body.validityMonths, 24);
  });

  test('4.6b edit: another manager -> 403, employee -> 403, no token -> 401', async () => {
    const body = { name: 'Data Protection Basics', category: 'Compliance', validityMonths: 6 };
    assert.equal((await call(app, 'PUT', `/api/trainings/${DATA_PROTECTION}`, { token: tokens.mona(), body })).status, 403);
    assert.equal((await call(app, 'PUT', `/api/trainings/${DATA_PROTECTION}`, { token: tokens.nour(), body })).status, 403);
    assert.equal((await call(app, 'PUT', `/api/trainings/${DATA_PROTECTION}`, { body })).status, 401);
    const unchanged = await call(app, 'GET', `/api/trainings/${DATA_PROTECTION}`, { token: tokens.omar() });
    assert.equal(unchanged.body.validityMonths, 12);
  });

  test('4.6b edit: unknown -> 404, malformed id -> 400, bad body -> 400, duplicate name -> 409', async () => {
    const ok = { name: 'Fire Safety', category: 'Safety' };
    assert.equal((await call(app, 'PUT', `/api/trainings/${UNKNOWN_TRAINING}`, { token: tokens.mona(), body: ok })).status, 404);
    assert.equal((await call(app, 'PUT', '/api/trainings/nope', { token: tokens.mona(), body: ok })).status, 400);
    assert.equal((await call(app, 'PUT', `/api/trainings/${FIRE_SAFETY}`, { token: tokens.mona(), body: { name: 'Fire Safety' } })).status, 400);
    const dup = await call(app, 'PUT', `/api/trainings/${FIRE_SAFETY}`, { token: tokens.mona(), body: { name: 'First Aid', category: 'Safety' } });
    assert.equal(dup.status, 409);
  });
});
