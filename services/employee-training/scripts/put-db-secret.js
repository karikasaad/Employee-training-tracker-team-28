// EN: Creates or updates the Secrets Manager secret "ett/db/s1" that Service 1 reads at start-up:
//     { username: "svc_s1", password, host, port, dbname }. Run it once after "python scripts/dev.py init"
//     and "node infra/db/load.js all" (from the repo root):
//         node services/employee-training/scripts/put-db-secret.js
//     The password is taken from your local, git-ignored .env (DB_S1_PASSWORD) and is NEVER printed.
//     On real AWS an administrator (or secret rotation) creates this secret instead.
// Franco: Beye3mel aw ye-update el secret "ett/db/s1" elly Service 1 bte2rah awel ma tebda2. Shaghalo mara
//     wa7da ba3d "dev.py init" w "load.js all". El password men el .env el local (DB_S1_PASSWORD) w 3OMRO
//     ma byet-teba3. 3ala AWS el 7a2i2i el admin (aw el rotation) howa elly beye3mel el secret.
'use strict';
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
function readEnv(file) {
  const env = {};
  if (fs.existsSync(file)) {
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (m && !line.trim().startsWith('#')) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
  return { ...env, ...process.env };
}

async function main() {
  const env = readEnv(path.join(repoRoot, '.env'));
  if (!env.DB_S1_PASSWORD) throw new Error('DB_S1_PASSWORD is missing in .env');
  const { SecretsManagerClient, PutSecretValueCommand, CreateSecretCommand } = require('@aws-sdk/client-secrets-manager');
  // EN: from this PC Floci is localhost:4566 (inside Docker it is "floci"). Dummy keys only.
  // Franco: men el PC da Floci howa localhost:4566 (gowwa Docker esmo "floci"). Keys wahmeya bas.
  const client = new SecretsManagerClient({
    region: env.AWS_DEFAULT_REGION || 'us-east-1',
    endpoint: env.AWS_ENDPOINT_URL_HOST || 'http://localhost:4566',
    credentials: { accessKeyId: env.FLOCI_ACCESS_KEY_ID || 'test', secretAccessKey: env.FLOCI_SECRET_ACCESS_KEY || 'test' },
  });
  const SecretString = JSON.stringify({
    username: 'svc_s1',
    password: env.DB_S1_PASSWORD,
    host: env.DB_HOST || 'postgres',
    port: Number(env.DB_PORT || 5432),
    dbname: env.POSTGRES_DB || 'ett',
  });
  try {
    await client.send(new PutSecretValueCommand({ SecretId: 'ett/db/s1', SecretString }));
    console.log('Updated secret ett/db/s1 (username svc_s1; password not printed).');
  } catch (err) {
    if (err.name !== 'ResourceNotFoundException') throw err;
    await client.send(new CreateSecretCommand({ Name: 'ett/db/s1', SecretString, Description: 'Service 1 database login (least-privilege role svc_s1)' }));
    console.log('Created secret ett/db/s1 (username svc_s1; password not printed).');
  }
}

main().catch((err) => { console.error(`Could not store the secret: ${err.name || ''} ${err.message}`); process.exit(1); });
