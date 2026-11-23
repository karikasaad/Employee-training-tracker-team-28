// EN: Tests for the Service 2 pages. (1) the pure helpers of frontend/s2/s2-common.js, run in Node; (2) static
//     safety checks on the page files: no inline scripts and no innerHTML (the strict CSP forbids inline scripts,
//     and innerHTML with API data would allow XSS).
// Franco: Tests le pages Service 2. (1) el helpers el pure fe frontend/s2/s2-common.js, betshtaghal fe Node;
//     (2) checks aman sabta 3ala files el pages: mafeesh scripts gowwa el HTML w mafeesh innerHTML (el CSP
//     el sarem beyemna3 el inline scripts, w innerHTML m3a data men el API beyefta7 XSS).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const s2 = require('../../../frontend/s2/s2-common');

const GOOD = {
  file: { name: 'fire.pdf', size: 1000 }, trainingId: 't1', title: 'Fire Safety', issuer: 'Institute',
  issueDate: '2026-01-01', expiryDate: '2027-01-01',
};

test('uploadProblems: a complete form has no problems', () => {
  assert.deepStrictEqual(s2.uploadProblems(GOOD), []);
});

test('uploadProblems: no file, too big, empty, wrong name', () => {
  assert.match(s2.uploadProblems({ ...GOOD, file: undefined })[0], /Choose a file/);
  assert.match(s2.uploadProblems({ ...GOOD, file: { name: 'a.pdf', size: 5 * 1024 * 1024 + 1 } })[0], /larger than 5 MB/);
  assert.match(s2.uploadProblems({ ...GOOD, file: { name: 'a.pdf', size: 0 } })[0], /empty/);
  assert.match(s2.uploadProblems({ ...GOOD, file: { name: 'virus.exe', size: 10 } })[0], /PDF, JPG or PNG/);
  assert.deepStrictEqual(s2.uploadProblems({ ...GOOD, file: { name: 'SCAN.JPEG', size: 5 * 1024 * 1024 } }), []);
});

test('uploadProblems: missing fields and issue date after expiry date', () => {
  assert.strictEqual(s2.uploadProblems({ ...GOOD, title: '  ' }).length, 1);
  assert.strictEqual(s2.uploadProblems({ ...GOOD, trainingId: '' }).length, 1);
  assert.match(s2.uploadProblems({ ...GOOD, issueDate: '2028-01-01' })[0], /not be after/);
  assert.strictEqual(s2.uploadProblems({}).length, 6);
});

test('buildUploadForm: the right fields, the file under "file", and NEVER an employeeId', () => {
  const file = new (require('node:buffer').File)(['%PDF-1.4'], 'fire.pdf', { type: 'application/pdf' });
  const form = s2.buildUploadForm({ ...GOOD, certificateNumber: ' FS-1 ', title: ' Fire ' }, file);
  const keys = [...form.keys()].sort();
  assert.deepStrictEqual(keys, ['certificateNumber', 'expiryDate', 'file', 'issueDate', 'issuer', 'title', 'trainingId']);
  assert.strictEqual(form.get('title'), 'Fire');
  assert.strictEqual(form.get('certificateNumber'), 'FS-1');
  assert.strictEqual(form.get('file').name, 'fire.pdf');
  assert.strictEqual(s2.buildUploadForm({ ...GOOD, certificateNumber: '' }, file).has('certificateNumber'), false);
});

test('rejectProblem: a reason of 1-500 characters is needed', () => {
  assert.match(s2.rejectProblem(''), /reason/);
  assert.match(s2.rejectProblem('   '), /reason/);
  assert.match(s2.rejectProblem('x'.repeat(501)), /500/);
  assert.strictEqual(s2.rejectProblem('The scan is unreadable'), null);
});

test('kindOf: colours of the status and validity badges', () => {
  assert.deepStrictEqual(['Verified', 'Valid', 'Pending', 'Expiring soon', 'Rejected', 'Expired', 'x'].map(s2.kindOf),
    ['ok', 'ok', 'warn', 'warn', 'bad', 'bad', '']);
});

// ---------------------------------------------------------------- static safety checks
const dir = path.join(__dirname, '..', '..', '..', 'frontend', 's2');
const files = fs.readdirSync(dir);

test('safety: the page scripts never use innerHTML, outerHTML, document.write, eval or inline handlers', () => {
  for (const f of files.filter((n) => n.endsWith('.js'))) {
    const code = fs.readFileSync(path.join(dir, f), 'utf8');
    assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write|\beval\(|new Function/.test(code), f);
  }
});

test('safety: the HTML pages have no inline <script> and no on...= handlers (strict CSP)', () => {
  for (const f of files.filter((n) => n.endsWith('.html'))) {
    const html = fs.readFileSync(path.join(dir, f), 'utf8');
    const scripts = [...html.matchAll(/<script\b[^>]*>/gi)].map((m) => m[0]);
    assert.ok(scripts.length >= 5, f);
    assert.ok(scripts.every((s) => /\bsrc="\/[^"]+"/.test(s)), `${f}: every script must have a src`);
    assert.ok(!/<script[^>]*>\s*\S/.test(html.replace(/<script\b[^>]*\bsrc=[^>]*><\/script>/gi, '')), `${f}: inline script found`);
    assert.ok(!/\son[a-z]+\s*=/i.test(html), `${f}: inline event handler found`);
  }
});

test('safety: the pages load only the shared shell and their own files', () => {
  for (const f of files.filter((n) => n.endsWith('.html'))) {
    const html = fs.readFileSync(path.join(dir, f), 'utf8');
    const srcs = [...html.matchAll(/<script src="([^"]+)"/g)].map((m) => m[1]);
    assert.deepStrictEqual(srcs.slice(0, 5), ['/common/config.js', '/config.local.js', '/common/auth.js', '/common/api.js', '/common/ui.js']);
    assert.ok(srcs.slice(5).every((s) => s.startsWith('/s2/')), f);
  }
});
