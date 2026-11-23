// EN: tests the REAL pre-signed link (signing is offline, so no S3 or Floci is needed). It proves the link
//     is valid for exactly 300 seconds, forces a download, and uses the public address.
//     Skipped (with a reason) only if the presigner library is not installed yet.
// Franco: bey-test el link el 7a2i2i m3a el tawqee3 (el tawqee3 offline, f mesh me7taga S3 wala Floci). Beyethbet en
//     el link sale7 300 sanya bel zabt w beygbor el download w beysta3mel el 3enwan el public.
//     Beyet-skip (b sabab) law maktabet el presigner lessa mesh mat-installed.
const test = require('node:test');
const assert = require('node:assert');
const { createStorage } = require('../src/storage');

let installed = true;
try { require.resolve('@aws-sdk/s3-request-presigner'); } catch { installed = false; }
const skip = installed ? false : 'install the dependencies first (python scripts/dev.py test does this)';

test('presignedDownloadUrl: 300 seconds, attachment, public address, path style', { skip }, async () => {
  const saved = { ...process.env };
  Object.assign(process.env, {
    AWS_ACCESS_KEY_ID: 'test', AWS_SECRET_ACCESS_KEY: 'test', AWS_DEFAULT_REGION: 'us-east-1',
    AWS_ENDPOINT_URL: 'http://floci:4566', S3_PUBLIC_ENDPOINT: 'http://localhost:4566',
  });
  try {
    const storage = createStorage({ bucket: 'certificates' });
    const url = new URL(await storage.presignedDownloadUrl('certificates/abc-123', {
      fileName: 'certificate-1.pdf', mimeType: 'application/pdf', expiresIn: 300,
    }));
    assert.strictEqual(url.origin, 'http://localhost:4566'); // EN: not the Docker name "floci" / Franco: mesh esm Docker "floci"
    assert.strictEqual(url.pathname, '/certificates/certificates/abc-123');
    assert.strictEqual(url.searchParams.get('X-Amz-Expires'), '300');
    assert.match(url.searchParams.get('response-content-disposition'), /^attachment; filename="certificate-1\.pdf"$/);
    assert.strictEqual(url.searchParams.get('response-content-type'), 'application/pdf');
    assert.ok(url.searchParams.get('X-Amz-Signature'));
  } finally {
    process.env = saved;
  }
});
