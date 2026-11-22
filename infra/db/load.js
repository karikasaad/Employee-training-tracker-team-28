// EN: Loads the database files into the Postgres container of docker compose. Works the same in
//     PowerShell, macOS and Linux (no bash needed). No npm packages: only Node's built-in modules.
// Franco: Bey7ammel files el database fe container el Postgres bta3 docker compose. Shaghal zay ba3do
//     fe PowerShell w Mac w Linux (mesh me7tag bash). Mafeesh npm packages: modules Node el gahza bas.
//
// Usage / el estekhdam (from the repo root):
//   node infra/db/load.js schema   -> tables, constraints, roles (safe to run twice)
//   node infra/db/load.js roles    -> service-role passwords from .env
//   node infra/db/load.js seed     -> wipes and re-creates the test data, prints the test users
//   node infra/db/load.js checks   -> database tests (rolled back, changes nothing)
//   node infra/db/load.js all      -> all four, in that order
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

// EN: read KEY=VALUE lines from the local .env (git-ignored). Real environment variables win.
// Franco: ye2ra satr KEY=VALUE men el .env el local (git-ignored). El environment el 7a2i2i liha el awlaweya.
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

const repoRoot = path.resolve(__dirname, '..', '..');
const env = readEnv(path.join(repoRoot, '.env'));
const service = env.POSTGRES_SERVICE || 'postgres';     // compose service name
const dbUser = env.POSTGRES_USER || 'postgres';
const dbName = env.POSTGRES_DB || 'training';

function runSql(file, extraArgs = [], passEnv = []) {
  const sql = fs.readFileSync(path.join(__dirname, file), 'utf8');
  console.log(`\n=== ${file} ===`);
  // EN: the SQL goes in through stdin, so no file path or secret appears in the process list.
  // Franco: el SQL beyedkhol men el stdin, f mafeesh path wala secret beyezhar fe list el processes.
  // EN: "-e NAME" without a value copies NAME from our environment into the container, so secret
  //     values are never written on the command line.
  // Franco: "-e NAME" men gheir value beyenqol NAME men el environment bta3na lel container, f el
  //     secrets 3omraha ma betetkteb fel command line.
  const envArgs = passEnv.flatMap((n) => ['-e', n]);
  const result = spawnSync('docker', ['compose', 'exec', '-T', ...envArgs, service,
    'psql', '-q', '-U', dbUser, '-d', dbName, '-v', 'ON_ERROR_STOP=1', ...extraArgs],
  { input: sql, cwd: repoRoot, env, stdio: ['pipe', 'inherit', 'inherit'] });
  if (result.error) { console.error(`Could not start docker: ${result.error.message}`); process.exit(1); }
  if (result.status !== 0) { console.error(`${file} FAILED (exit ${result.status})`); process.exit(result.status); }
}

function roles() {
  const names = ['DB_S1_PASSWORD', 'DB_S2_PASSWORD', 'DB_S3_PASSWORD'];
  const missing = names.filter((n) => !env[n]);
  if (missing.length) {
    console.error(`Missing in .env: ${missing.join(', ')} (see .env.example). Nothing changed.`);
    process.exit(1);
  }
  // EN: passed as environment variables; roles.sql reads them with \getenv. They are never printed.
  // Franco: betet-ba3at ka environment variables; roles.sql bey2rahom b \getenv. 3omraha ma betet-teba3.
  runSql('roles.sql', [], names);
}

const steps = { schema: () => runSql('schema.sql'), roles, seed: () => runSql('seed.sql'), checks: () => runSql('checks.sql') };
const wanted = process.argv[2] || 'all';
if (wanted === 'all') {
  steps.schema(); steps.roles(); steps.seed(); steps.checks();
} else if (steps[wanted]) {
  steps[wanted]();
} else {
  console.error(`Unknown step "${wanted}". Use: schema | roles | seed | checks | all`);
  process.exit(1);
}
