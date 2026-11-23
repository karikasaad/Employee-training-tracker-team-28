// EN: unit tests: the file type is found from the first bytes only.
// Franco: unit tests: noo3 el file bey-et3araf men awel bytes bas.
const test = require('node:test');
const assert = require('node:assert');
const { detectMimeType } = require('../src/fileType');

test('detectMimeType: PDF, JPEG and PNG by magic bytes', () => {
  assert.strictEqual(detectMimeType(Buffer.from('%PDF-1.7 rest')), 'application/pdf');
  assert.strictEqual(detectMimeType(Buffer.from([0xff, 0xd8, 0xff, 0xdb])), 'image/jpeg');
  assert.strictEqual(detectMimeType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d])), 'image/png');
});

test('detectMimeType: text, GIF, ZIP and EXE are refused even if the name says PDF', () => {
  assert.strictEqual(detectMimeType(Buffer.from('just some text, file name cert.pdf')), null);
  assert.strictEqual(detectMimeType(Buffer.from('GIF89a....')), null);
  assert.strictEqual(detectMimeType(Buffer.from([0x50, 0x4b, 0x03, 0x04])), null); // ZIP
  assert.strictEqual(detectMimeType(Buffer.from([0x4d, 0x5a, 0x90, 0x00])), null); // Windows EXE
});

test('detectMimeType: too short, empty and not a Buffer', () => {
  assert.strictEqual(detectMimeType(Buffer.from([0x25, 0x50])), null);
  assert.strictEqual(detectMimeType(Buffer.alloc(0)), null);
  assert.strictEqual(detectMimeType('%PDF'), null);
  assert.strictEqual(detectMimeType(null), null);
});
