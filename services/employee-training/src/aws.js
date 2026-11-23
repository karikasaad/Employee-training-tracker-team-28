// EN: Service 1's use of AWS (simulated by Floci locally, the same code runs on real AWS):
//       1. Secrets Manager: the database login of S1 (role svc_s1 + password) is read from the secret
//          "ett/db/s1" at start-up, so no database password has to live in a file the service reads.
//       2. CloudWatch Logs: every log line is also sent to the log group "/ett/s1" (batches every 2 s).
//     The AWS endpoint, region and keys come from the environment (AWS_ENDPOINT_URL, AWS_REGION/
//     AWS_DEFAULT_REGION, AWS_ACCESS_KEY_ID...), never from the code.
// Franco: Estekhdam Service 1 le AWS (Floci beye3melo simulate local, w nafs el code yeshtaghal 3ala AWS):
//       1. Secrets Manager: login el database bta3 S1 (role svc_s1 + el password) bey-et2ery men el secret
//          "ett/db/s1" awel ma el service tebda2, f mafeesh password database fe file el service bte2rah.
//       2. CloudWatch Logs: kol satr log beyetba3at kaman lel log group "/ett/s1" (kol 2 sanya).
//     El endpoint w el region w el keys men el environment, 3omrhom ma fel code.
'use strict';
const os = require('node:os');

function awsClientConfig(env = process.env) {
  const config = { region: env.AWS_REGION || env.AWS_DEFAULT_REGION || 'us-east-1' };
  if (env.AWS_ENDPOINT_URL) config.endpoint = env.AWS_ENDPOINT_URL; // EN: Floci locally / Franco: Floci local
  return config;
}

// EN: which secret to read. In the Docker image (NODE_ENV=production) the default is "ett/db/s1";
//     in local tests nothing is read unless DB_SECRET_ID is set. DB_SECRET_ID=none switches it off.
// Franco: anhi secret ne2rah. Gowwa el Docker image el default "ett/db/s1"; fel tests el local mafeesh
//     qeraya ela law DB_SECRET_ID mawgood. DB_SECRET_ID=none bey2fel el feature.
function dbSecretId(env = process.env) {
  if (env.DB_SECRET_ID === 'none') return null;
  if (env.DB_SECRET_ID) return env.DB_SECRET_ID;
  return env.NODE_ENV === 'production' ? 'ett/db/s1' : null;
}

function logGroupName(env = process.env) {
  if (env.CLOUDWATCH_LOG_GROUP === 'none') return null;
  if (env.CLOUDWATCH_LOG_GROUP) return env.CLOUDWATCH_LOG_GROUP;
  return env.NODE_ENV === 'production' ? '/ett/s1' : null;
}

// ---------------------------------------------------------------------------- 1. Secrets Manager
// EN: Read the S1 database login from Secrets Manager. The secret is JSON:
//     { "username": "svc_s1", "password": "...", "host"?, "port"?, "dbname"? }.
//     Security checks: if the secret cannot be read, S1 does NOT start (fail closed, no silent fallback to a
//     file), and it refuses an admin login: the user must be one of the least-privilege roles svc_*.
// Franco: Ne2ra login el database bta3 S1 men Secrets Manager. Checks amn: law el secret mayet2erash, S1
//     MATEBDA2SH (fail closed, mafeesh rogoo3 le file), w bterfod login admin: el user lazem role svc_*.
async function loadDbConfigFromSecret(baseConfig, { secretId, client, env = process.env }) {
  const { GetSecretValueCommand } = require('@aws-sdk/client-secrets-manager');
  let secret;
  try {
    const out = await client.send(new GetSecretValueCommand({ SecretId: secretId }));
    secret = JSON.parse(out.SecretString);
  } catch (err) {
    throw new Error(`Cannot read the database secret "${secretId}" from Secrets Manager (${err.name || err.message}). S1 will not start.`);
  }
  if (!secret || typeof secret.username !== 'string' || typeof secret.password !== 'string' || !secret.password) {
    throw new Error(`Secret "${secretId}" must contain a username and a password.`);
  }
  if (!/^svc_s[0-9]$/.test(secret.username) || secret.username === env.POSTGRES_USER) {
    throw new Error(`Secret "${secretId}" must hold a least-privilege service role (svc_s1), not "${secret.username}".`);
  }
  return {
    ...baseConfig,
    user: secret.username,
    password: secret.password,
    host: secret.host || baseConfig.host,
    port: Number(secret.port || baseConfig.port),
    database: secret.dbname || baseConfig.database,
  };
}

// ---------------------------------------------------------------------------- 2. CloudWatch Logs
// EN: A "write" function for services/common/logging.js: every line goes to stdout (Docker logs) AND into a
//     small buffer that is sent to CloudWatch every 2 seconds. The lines are already redacted by the logger
//     (no tokens/passwords). If CloudWatch is down we keep at most 1000 lines and never crash the service.
// Franco: function "write" le services/common/logging.js: kol satr beyro7 stdout (logs Docker) W buffer
//     so8ayyar beyetba3at le CloudWatch kol 2 sanya. El sotoor met-khabbeya aslan men el logger (mafeesh
//     tokens/passwords). Law CloudWatch wa2e3 ben7tefez be 1000 satr bel kteer w 3omr el service ma ted-rab.
function createCloudWatchWriter({ client, logGroup, logStream = `s1-${os.hostname()}-${Date.now()}`, flushMs = 2000,
  maxBuffer = 1000, stdout = (l) => process.stdout.write(`${l}\n`), warn = (m) => process.stderr.write(`${m}\n`) }) {
  const { CreateLogStreamCommand, PutLogEventsCommand } = require('@aws-sdk/client-cloudwatch-logs');
  let buffer = [];
  let streamReady = false;
  let warned = false;
  let sending = null;

  async function ensureStream() {
    if (streamReady) return;
    try {
      await client.send(new CreateLogStreamCommand({ logGroupName: logGroup, logStreamName: logStream }));
    } catch (err) {
      if (err.name !== 'ResourceAlreadyExistsException') throw err;
    }
    streamReady = true;
  }

  // EN: send what is buffered (in time order, max 1000 per call, the CloudWatch limit is 10000).
  // Franco: neb3at elly fel buffer (bel tarteeb, 1000 bel kteer fel marra).
  async function flush() {
    if (sending) return sending;
    if (buffer.length === 0) return undefined;
    const batch = buffer.slice(0, 1000);
    sending = (async () => {
      try {
        await ensureStream();
        await client.send(new PutLogEventsCommand({ logGroupName: logGroup, logStreamName: logStream, logEvents: batch }));
        buffer = buffer.slice(batch.length);
        warned = false;
      } catch (err) {
        if (!warned) warn(JSON.stringify({ level: 'warn', service: 'employee-training', event: 'cloudwatch_unavailable', message: err.name || err.message }));
        warned = true;
      } finally {
        sending = null;
      }
    })();
    return sending;
  }

  const timer = setInterval(flush, flushMs);
  if (timer.unref) timer.unref(); // EN: never keeps the process alive / Franco: mayekhallish el process 3ayesh

  function write(line) {
    stdout(line);
    buffer.push({ timestamp: Date.now(), message: line });
    if (buffer.length > maxBuffer) buffer = buffer.slice(buffer.length - maxBuffer);
  }

  return { write, flush, stop: () => clearInterval(timer), logStream, pending: () => buffer.length };
}

module.exports = { awsClientConfig, dbSecretId, logGroupName, loadDbConfigFromSecret, createCloudWatchWriter };
