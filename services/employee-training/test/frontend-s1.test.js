// EN: Unit tests for the pure helpers of the Service 1 pages (frontend/s1/s1-common.js), run in Node.
//     The browser checks only help the user; the API repeats every check (tested in the API tests).
// Franco: Unit tests lel helpers el pure bta3et pages Service 1, betshtaghal fe Node.
//     Checks el browser betsa3ed el user bas; el API bey3eed kol check (mat-test fel API tests).
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const s1 = require('../../../frontend/s1/s1-common');

test('statusClass: Completed green, Assigned orange, Overdue red', () => {
  assert.equal(s1.statusClass('Completed'), 'ok');
  assert.equal(s1.statusClass('Assigned'), 'warn');
  assert.equal(s1.statusClass('Overdue'), 'bad');
  assert.equal(s1.statusClass('Something else'), '');
});

test('countByStatus uses the status the backend calculated', () => {
  const rows = [{ status: 'Overdue' }, { status: 'Overdue' }, { status: 'Assigned' }, { status: 'Completed' }, { status: 'Weird' }];
  assert.deepEqual(s1.countByStatus(rows), { Assigned: 1, Overdue: 2, Completed: 1 });
  assert.deepEqual(s1.countByStatus([]), { Assigned: 0, Overdue: 0, Completed: 0 });
});

test('dayOf and todayUtc', () => {
  assert.equal(s1.dayOf('2026-11-23T09:00:00.000Z'), '2026-11-23');
  assert.equal(s1.dayOf(null), '-');
  assert.equal(s1.todayUtc(new Date('2026-11-24T00:10:00+02:00')), '2026-11-23');
});

test('buildAssignBody: whole team vs one employee, and the friendly checks', () => {
  const base = { teamId: 't1', trainingId: 'tr1', dueDate: '2026-12-01' };
  assert.deepEqual(s1.buildAssignBody({ ...base, target: 'team' }, '2026-11-23'), { body: { teamId: 't1', trainingId: 'tr1', dueDate: '2026-12-01' } });
  assert.deepEqual(s1.buildAssignBody({ ...base, target: 'e7' }, '2026-11-23'), { body: { employeeId: 'e7', trainingId: 'tr1', dueDate: '2026-12-01' } });
  assert.ok(s1.buildAssignBody({ ...base, target: 'team', dueDate: '2026-11-22' }, '2026-11-23').error);
  assert.deepEqual(s1.buildAssignBody({ ...base, target: 'team', dueDate: '2026-11-23' }, '2026-11-23').body.dueDate, '2026-11-23');
  assert.ok(s1.buildAssignBody({ ...base, target: 'team', trainingId: '' }, '2026-11-23').error);
  assert.ok(s1.buildAssignBody({ ...base, target: '', }, '2026-11-23').error);
  assert.ok(s1.buildAssignBody({ ...base, target: 'team', dueDate: '' }, '2026-11-23').error);
});

test('buildTrainingBody: trims text, empty "valid for" = never expires, range 1-120', () => {
  assert.deepEqual(s1.buildTrainingBody({ name: ' Fire ', category: ' Safety ', requiresCertificate: true, validityMonths: '12' }),
    { body: { name: 'Fire', category: 'Safety', requiresCertificate: true, validityMonths: 12 } });
  assert.equal(s1.buildTrainingBody({ name: 'A', category: 'B', validityMonths: '' }).body.validityMonths, null);
  assert.ok(s1.buildTrainingBody({ name: '', category: 'B' }).error);
  assert.ok(s1.buildTrainingBody({ name: 'A', category: ' ' }).error);
  assert.ok(s1.buildTrainingBody({ name: 'A', category: 'B', validityMonths: '0' }).error);
  assert.ok(s1.buildTrainingBody({ name: 'A', category: 'B', validityMonths: '1.5' }).error);
});

test('assignResultText for the whole-team answer', () => {
  assert.equal(s1.assignResultText({ created: [1, 2, 3], skipped: [1] }), 'Assigned to 3 team member(s). 1 already had it open and were skipped.');
  assert.equal(s1.assignResultText({ created: [1], skipped: [] }), 'Assigned to 1 team member(s).');
});
