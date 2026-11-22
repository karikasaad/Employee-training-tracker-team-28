// EN: first test: /health must answer 200 and {status:'ok'}. Uses Node's built-in test runner.
// Franco: awel test: /health lazem yerod 200 w {status:'ok'}. Beyest3mel el test runner el gahez fe Node.
const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const { createApp } = require('../src/app');

function get(port, path) {
  return new Promise((resolve, reject) => {
    http
      .get({ port, path }, (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(data) }));
      })
      .on('error', reject);
  });
}

test('GET /health returns 200 and status ok', async () => {
  const server = createApp().listen(0); // 0 = any free port
  try {
    const { port } = server.address();
    const res = await get(port, '/health');
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.status, 'ok');
    assert.strictEqual(res.body.service, 'employee-training');
  } finally {
    server.close();
  }
});
