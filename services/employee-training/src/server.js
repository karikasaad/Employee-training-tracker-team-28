// EN: starts Service 1. Port comes from the environment (PORT), default 5001.
//     In Docker (NODE_ENV=production) it first reads its database login from Secrets Manager ("ett/db/s1")
//     and sends its logs to CloudWatch Logs ("/ett/s1"); see src/aws.js. If the secret cannot be read the
//     service does not start (fail closed).
// Franco: bey-ebda2 Service 1. El port men el environment (PORT), el default 5001.
//     Fel Docker (NODE_ENV=production) el awel bye2ra login el database men Secrets Manager ("ett/db/s1")
//     w beyeb3at el logs le CloudWatch Logs ("/ett/s1"); shoof src/aws.js. Law el secret mayet2erash el
//     service matebda2sh (fail closed).
'use strict';
const { createApp } = require('./app');
const { createLogger } = require('../../common/logging');
const { poolConfigFromEnv } = require('../../common/db');
const { awsClientConfig, dbSecretId, logGroupName, loadDbConfigFromSecret, createCloudWatchWriter } = require('./aws');

async function start(env = process.env, clients = {}) {
  // EN: logs: stdout always; CloudWatch too when a log group is configured.
  // Franco: el logs: stdout dayman; w CloudWatch kaman law fi log group.
  let write;
  let cloudWatch = null;
  const group = logGroupName(env);
  if (group) {
    const { CloudWatchLogsClient } = require('@aws-sdk/client-cloudwatch-logs');
    cloudWatch = createCloudWatchWriter({ client: clients.logs || new CloudWatchLogsClient(awsClientConfig(env)), logGroup: group });
    write = cloudWatch.write;
  }
  const logger = createLogger('employee-training', write ? { write } : {});

  // EN: database login: from Secrets Manager when a secret id is configured, else from the environment.
  // Franco: login el database: men Secrets Manager law fi secret id, w gheir kda men el environment.
  let dbConfig;
  const secretId = dbSecretId(env);
  if (secretId) {
    const { SecretsManagerClient } = require('@aws-sdk/client-secrets-manager');
    const base = poolConfigFromEnv({ DB_USER: 'from-secret', DB_PASSWORD: 'from-secret', DB_NAME: 'ett', DB_HOST: 'postgres', ...env });
    dbConfig = await loadDbConfigFromSecret(base, { secretId, client: clients.secrets || new SecretsManagerClient(awsClientConfig(env)), env });
    // EN: the field names avoid the word "secret" on purpose: the logger hides any such field, and the secret's
    //     NAME is not sensitive. The password itself is never logged.
    // Franco: asamy el fields men gheir kelmet "secret" 3ala gheer: el logger bey-khabby ay field keda, w ESM el
    //     secret mesh sereya. El password nafsaha 3omraha ma betet-log.
    logger.info('db_login_loaded', { source: `Secrets Manager ${secretId}`, dbUser: dbConfig.user });
  }

  const app = createApp({ logger, dbConfig });
  const port = Number(env.PORT || 5001);
  const server = await new Promise((resolve) => {
    const s = app.listen(port, '0.0.0.0', () => resolve(s));
  });
  logger.info('listening', { port: server.address().port, cloudWatchLogGroup: group, dbLoginFrom: secretId ? `Secrets Manager ${secretId}` : 'environment' });
  return { server, logger, cloudWatch, dbConfig };
}

if (require.main === module) {
  start().catch((err) => {
    // EN: fail closed: print why (no secret values) and exit, so Docker shows the service as stopped.
    // Franco: fail closed: netba3 leh (men gheir values sereya) w nekhrog, f Docker yewarry en el service wa2fa.
    process.stderr.write(`${JSON.stringify({ level: 'error', service: 'employee-training', event: 'startup_failed', message: err.message })}\n`);
    process.exit(1);
  });
}

module.exports = { start };
