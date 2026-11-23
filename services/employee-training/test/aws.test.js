// EN: Tests for Service 1's AWS use (src/aws.js, src/server.js). They run the REAL AWS SDK over HTTP against a
//     tiny fake AWS endpoint (same wire protocol as Floci / AWS: JSON with an X-Amz-Target header), so the real
//     requests are checked: Secrets Manager GetSecretValue, CloudWatch Logs CreateLogStream + PutLogEvents.
// Franco: Tests le estekhdam Service 1 le AWS. Beyshaghalo el AWS SDK el 7a2i2i 3an taree2 HTTP 3ala endpoint
//     AWS mozayyaf so8ayyar (nafs el protocol bta3 Floci / AWS), f el requests el 7a2i2eya bet-et-check.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { SecretsManagerClient } = require('@aws-sdk/client-secrets-manager');
const { CloudWatchLogsClient } = require('@aws-sdk/client-cloudwatch-logs');
const { dbSecretId, logGroupName, awsClientConfig, loadDbConfigFromSecret, createCloudWatchWriter } = require('../src/aws');
const { start } = require('../src/server');
const { createLogger } = require('../../common/logging');

// ------------------------------------------------------------ fake AWS endpoint
function fakeAws({ secrets = {}, logsDown = false } = {}) {
  const calls = [];
  const events = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const target = req.headers['x-amz-target'] || '';
      const input = body ? JSON.parse(body) : {};
      calls.push({ target, input, signed: /^AWS4-HMAC-SHA256 /.test(req.headers.authorization || '') });
      const reply = (status, obj) => { res.writeHead(status, { 'content-type': 'application/x-amz-json-1.1' }); res.end(JSON.stringify(obj)); };
      if (target === 'secretsmanager.GetSecretValue') {
        if (!(input.SecretId in secrets)) return reply(400, { __type: 'ResourceNotFoundException', message: 'Secrets Manager cannot find the specified secret.' });
        return reply(200, { Name: input.SecretId, SecretString: secrets[input.SecretId] });
      }
      if (target.startsWith('Logs_20140328.') && logsDown) return reply(500, { __type: 'ServiceUnavailableException', message: 'down' });
      if (target === 'Logs_20140328.CreateLogStream') return reply(200, {});
      if (target === 'Logs_20140328.PutLogEvents') { events.push(...input.logEvents); return reply(200, { nextSequenceToken: '1' }); }
      return reply(400, { __type: 'UnknownOperationException', message: target });
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({
    url: `http://127.0.0.1:${server.address().port}`, calls, events, close: () => server.close(),
  })));
}
const sdk = (Client, url) => new Client({ region: 'us-east-1', endpoint: url, credentials: { accessKeyId: 'test', secretAccessKey: 'test' }, maxAttempts: 1 });
const BASE = { host: 'postgres', port: 5432, database: 'ett', user: 'x', password: 'x' };

// ------------------------------------------------------------ settings
test('settings: on in Docker (NODE_ENV=production), off in local tests, "none" switches off', () => {
  assert.equal(dbSecretId({ NODE_ENV: 'production' }), 'ett/db/s1');
  assert.equal(logGroupName({ NODE_ENV: 'production' }), '/ett/s1');
  assert.equal(dbSecretId({}), null);
  assert.equal(logGroupName({}), null);
  assert.equal(dbSecretId({ NODE_ENV: 'production', DB_SECRET_ID: 'none' }), null);
  assert.equal(dbSecretId({ DB_SECRET_ID: 'other/secret' }), 'other/secret');
  assert.deepEqual(awsClientConfig({ AWS_ENDPOINT_URL: 'http://floci:4566', AWS_DEFAULT_REGION: 'eu-west-1' }), { region: 'eu-west-1', endpoint: 'http://floci:4566' });
});

// ------------------------------------------------------------ Secrets Manager
test('Secrets Manager: the S1 database login is read from ett/db/s1 (real SDK request, signed)', async () => {
  const aws = await fakeAws({ secrets: { 'ett/db/s1': JSON.stringify({ username: 'svc_s1', password: 'not-a-real-secret-1', host: 'postgres', port: 5432, dbname: 'ett' }) } });
  try {
    const cfg = await loadDbConfigFromSecret(BASE, { secretId: 'ett/db/s1', client: sdk(SecretsManagerClient, aws.url), env: { POSTGRES_USER: 'ett_admin' } });
    assert.equal(cfg.user, 'svc_s1');
    assert.equal(cfg.password, 'not-a-real-secret-1');
    assert.equal(cfg.database, 'ett');
    assert.deepEqual(aws.calls.map((c) => [c.target, c.input.SecretId, c.signed]), [['secretsmanager.GetSecretValue', 'ett/db/s1', true]]);
  } finally { aws.close(); }
});

test('Secrets Manager: missing secret -> S1 refuses to start (fail closed, no fallback)', async () => {
  const aws = await fakeAws({ secrets: {} });
  try {
    await assert.rejects(loadDbConfigFromSecret(BASE, { secretId: 'ett/db/s1', client: sdk(SecretsManagerClient, aws.url) }),
      /Cannot read the database secret "ett\/db\/s1".*ResourceNotFoundException.*will not start/);
  } finally { aws.close(); }
});

test('Secrets Manager: an admin login in the secret is refused (least privilege)', async () => {
  const aws = await fakeAws({ secrets: { 'ett/db/s1': JSON.stringify({ username: 'ett_admin', password: 'p' }), bad: '{"username":"svc_s1"}' } });
  try {
    const client = sdk(SecretsManagerClient, aws.url);
    await assert.rejects(loadDbConfigFromSecret(BASE, { secretId: 'ett/db/s1', client, env: { POSTGRES_USER: 'ett_admin' } }), /least-privilege service role/);
    await assert.rejects(loadDbConfigFromSecret(BASE, { secretId: 'bad', client }), /username and a password/);
  } finally { aws.close(); }
});

// ------------------------------------------------------------ CloudWatch Logs
test('CloudWatch Logs: lines are sent to /ett/s1 with CreateLogStream + PutLogEvents, already redacted', async () => {
  const aws = await fakeAws();
  const printed = [];
  try {
    const cw = createCloudWatchWriter({ client: sdk(CloudWatchLogsClient, aws.url), logGroup: '/ett/s1', logStream: 's1-test', stdout: (l) => printed.push(l), flushMs: 60000 });
    const logger = createLogger('employee-training', { write: cw.write });
    logger.warn('forbidden', { path: '/api/teams/x/assignments', authorization: 'Bearer eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJ4In0.c2lnbmF0dXJl' });
    logger.info('request', { path: '/api/assignments/me', status: 200 });
    await cw.flush();
    cw.stop();
    assert.deepEqual(aws.calls.map((c) => c.target), ['Logs_20140328.CreateLogStream', 'Logs_20140328.PutLogEvents']);
    assert.equal(aws.calls[1].input.logGroupName, '/ett/s1');
    assert.equal(aws.events.length, 2);
    assert.equal(JSON.parse(aws.events[0].message).event, 'forbidden');
    assert.ok(!aws.events[0].message.includes('eyJhbGci'), 'token must not reach CloudWatch');
    assert.equal(printed.length, 2, 'still printed to stdout (docker logs)');
    assert.equal(cw.pending(), 0);
  } finally { aws.close(); }
});

test('CloudWatch Logs: if CloudWatch is down the service keeps working, warns once, and keeps at most maxBuffer lines', async () => {
  const aws = await fakeAws({ logsDown: true });
  const warnings = [];
  try {
    const cw = createCloudWatchWriter({ client: sdk(CloudWatchLogsClient, aws.url), logGroup: '/ett/s1', stdout: () => {}, warn: (m) => warnings.push(m), flushMs: 60000, maxBuffer: 5 });
    for (let i = 0; i < 8; i += 1) cw.write(`line ${i}`);
    await cw.flush();
    await cw.flush();
    cw.stop();
    assert.equal(cw.pending(), 5);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /cloudwatch_unavailable/);
  } finally { aws.close(); }
});

// ------------------------------------------------------------ start-up (server.js) the way Docker runs it
test('start-up in "Docker mode": reads the secret, ships logs to CloudWatch, /health answers', async () => {
  const aws = await fakeAws({ secrets: { 'ett/db/s1': JSON.stringify({ username: 'svc_s1', password: 'not-a-real-secret-2' }) } });
  const env = { NODE_ENV: 'production', PORT: '0', AWS_ENDPOINT_URL: aws.url, DB_HOST: 'postgres', DB_NAME: 'ett', AWS_ACCESS_KEY_ID: 'test', AWS_SECRET_ACCESS_KEY: 'test' };
  const { server, cloudWatch, dbConfig } = await start(env, { secrets: sdk(SecretsManagerClient, aws.url), logs: sdk(CloudWatchLogsClient, aws.url) });
  try {
    assert.equal(dbConfig.user, 'svc_s1');
    const res = await fetch(`http://127.0.0.1:${server.address().port}/health`);
    assert.equal(res.status, 200);
    await new Promise((r) => setTimeout(r, 20));
    await cloudWatch.flush();
    const sent = aws.events.map((e) => JSON.parse(e.message).event);
    assert.ok(sent.includes('db_login_loaded') && sent.includes('listening') && sent.includes('request'), sent.join(','));
    assert.ok(!aws.events.some((e) => e.message.includes('not-a-real-secret-2')), 'the password is never logged');
    const loaded = aws.events.map((e) => JSON.parse(e.message)).find((e) => e.event === 'db_login_loaded');
    assert.equal(loaded.source, 'Secrets Manager ett/db/s1'); // EN: which secret, visible in the log / Franco: anhi secret, bayen fel log
  } finally { cloudWatch.stop(); server.close(); aws.close(); }
});

test('start-up in "Docker mode" without the secret -> start fails (the container stops)', async () => {
  const aws = await fakeAws({ secrets: {} });
  try {
    await assert.rejects(start({ NODE_ENV: 'production', PORT: '0', AWS_ENDPOINT_URL: aws.url, CLOUDWATCH_LOG_GROUP: 'none' },
      { secrets: sdk(SecretsManagerClient, aws.url) }), /will not start/);
  } finally { aws.close(); }
});
