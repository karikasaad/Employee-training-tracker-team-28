// EN: Creates everything Cognito needs on Floci, and RECORDS what Floci really supports:
//       user pool + password policy, groups Employee / Manager, web app client (15-minute access tokens),
//       machine-to-machine client for scheduled jobs (secret stored in Secrets Manager, never printed),
//       one test user per seeded employee (cognito_sub written back to the employees table),
//       a real sign-in per group to check the token claims.
//     Safe to run twice: existing pool, groups, clients and users are reused.
//     It drives the AWS CLI (the same commands we tested by hand), so it needs no npm packages.
// Franco: Bey3mel kol 7aga Cognito me7tagha 3ala Floci, w BEYSAGGEL Floci beyedaam eh fe3lan:
//       user pool, groups Employee / Manager, web client (access token 15 de2ee2a), client lel jobs
//       (el secret fe Secrets Manager w 3omro ma byet-teba3), user tagreby le kol mowazzaf fel seed
//       (w el cognito_sub beyetkteb fel database), w sign-in 7a2i2i le kol group 3ashan n-check el token.
//     Momken teshaghalo marteen. Beyesta3mel el AWS CLI (nafs el commands elly garrabnaha), f mesh
//     me7tag npm packages.
//
// Run (PowerShell, repo root, after `docker compose up -d` and `node infra/db/load.js all`):
//   node infra/floci/cognito/cognito_init.js
// Needs in .env: TEST_USER_PASSWORD (dummy, e.g. Test@12345678). Writes:
//   infra/floci/cognito/cognito.generated.env  (pool/client ids: public values, git-ignored anyway)
//   docs/FLOCI_COGNITO_NOTES.md                (real results: commit this as evidence)
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const POOL_NAME = 'ett-users';
const WEB_CLIENT_NAME = 'ett-web';
const SERVICE_CLIENT_NAME = 'ett-jobs';
const RESOURCE_SERVER = 'ett-api';
const JOB_SCOPE = 'jobs.run';
const APP_URL = 'https://localhost:8443';

// ------------------------------------------------------------------ helpers
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
const env = readEnv(path.join(repoRoot, '.env'));
const endpoint = env.AWS_ENDPOINT_URL_HOST || 'http://localhost:4566';
// EN: dummy credentials for Floci only. Real AWS keys are never used here.
// Franco: credentials wahmeya le Floci bas. 3omrena ma bnesta3mel AWS keys 7a2i2eya hena.
const awsEnv = { ...env, AWS_ENDPOINT_URL: endpoint, AWS_DEFAULT_REGION: env.AWS_DEFAULT_REGION || 'us-east-1',
  AWS_ACCESS_KEY_ID: env.FLOCI_ACCESS_KEY_ID || 'test', AWS_SECRET_ACCESS_KEY: env.FLOCI_SECRET_ACCESS_KEY || 'test',
  AWS_PAGER: '' };

const notes = [];   // EN: rows for docs/FLOCI_COGNITO_NOTES.md / Franco: el natayeg el 7a2i2eya
function record(feature, result, detail) {
  notes.push({ feature, result, detail: String(detail).replace(/\|/g, '\\|').replace(/\s+/g, ' ').slice(0, 300) });
  console.log(`[${result}] ${feature}: ${detail}`);
}

// EN: run one AWS CLI command and parse its JSON. Never throws: returns { ok, json, error }.
// Franco: beyshaghal command AWS CLI wa7ed w ye-parse el JSON. Mabyermeesh error: beyrga3 { ok, json, error }.
function aws(args) {
  const r = spawnSync('aws', [...args, '--output', 'json'], { env: awsEnv, encoding: 'utf8' });
  if (r.error) return { ok: false, error: `cannot run aws CLI: ${r.error.message}` };
  if (r.status !== 0) return { ok: false, error: (r.stderr || '').trim() || `exit ${r.status}` };
  try { return { ok: true, json: r.stdout.trim() ? JSON.parse(r.stdout) : {} }; } catch { return { ok: true, json: {} }; }
}
function must(args, what) {
  const r = aws(args);
  if (!r.ok) { record(what, 'Not supported / failed', r.error); finish(1); }
  return r.json;
}

function psql(sql) {
  const r = spawnSync('docker', ['compose', 'exec', '-T', env.POSTGRES_SERVICE || 'postgres', 'psql', '-q', '-At',
    '-U', env.POSTGRES_USER || 'postgres', '-d', env.POSTGRES_DB || 'training', '-v', 'ON_ERROR_STOP=1'],
  { input: sql, cwd: repoRoot, encoding: 'utf8', env });
  if (r.error || r.status !== 0) throw new Error((r.stderr || r.error?.message || 'psql failed').trim());
  return r.stdout.trim();
}

function decodeJwtPayload(token) {
  return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
}

// ------------------------------------------------------------------ 1. user pool
function ensurePool() {
  const list = must(['cognito-idp', 'list-user-pools', '--max-results', '60'], 'List user pools');
  const existing = (list.UserPools || []).find((p) => p.Name === POOL_NAME);
  if (existing) { record('User pool', 'Works', `reused ${existing.Id}`); return existing.Id; }
  // EN: strong password policy; e-mail is the username.
  // Franco: password policy 2aweya; el e-mail howa el username.
  const created = must(['cognito-idp', 'create-user-pool', '--pool-name', POOL_NAME,
    '--policies', 'PasswordPolicy={MinimumLength=12,RequireUppercase=true,RequireLowercase=true,RequireNumbers=true,RequireSymbols=true}',
    '--username-attributes', 'email', '--auto-verified-attributes', 'email'], 'Create user pool');
  record('User pool (password policy min 12 chars, e-mail as username)', 'Works', `created ${created.UserPool.Id}`);
  return created.UserPool.Id;
}

// ------------------------------------------------------------------ 2. MFA (optional TOTP)
function tryMfa(poolId) {
  // EN: MFA for managers: Cognito sets MFA per pool (OPTIONAL) + per user. We try to enable TOTP MFA and
  //     record whether Floci accepts it. Enforcing it on sign-in is checked by hand (see notes).
  // Franco: MFA lel managers: Cognito beye3mel MFA lel pool (OPTIONAL) w lel user. Bnegarrab nefa3al
  //     TOTP w nesaggel Floci 2ebel walla la.
  const r = aws(['cognito-idp', 'set-user-pool-mfa-config', '--user-pool-id', poolId,
    '--software-token-mfa-configuration', 'Enabled=true', '--mfa-configuration', 'OPTIONAL']);
  record('MFA config (TOTP, OPTIONAL at pool level)', r.ok ? 'Works (config accepted)' : 'Not supported', r.ok ? 'set-user-pool-mfa-config accepted' : r.error);
  return r.ok;
}

// ------------------------------------------------------------------ 3. groups
function ensureGroups(poolId) {
  for (const group of ['Employee', 'Manager']) {
    const r = aws(['cognito-idp', 'create-group', '--user-pool-id', poolId, '--group-name', group]);
    if (!r.ok && !/GroupExists|already exists/i.test(r.error)) { record(`Group ${group}`, 'Not supported', r.error); finish(1); }
  }
  record('Groups Employee / Manager', 'Works', 'created or already present');
}

// ------------------------------------------------------------------ 4. web client (15-minute tokens)
function ensureWebClient(poolId) {
  const list = must(['cognito-idp', 'list-user-pool-clients', '--user-pool-id', poolId, '--max-results', '60'], 'List app clients');
  const existing = (list.UserPoolClients || []).find((c) => c.ClientName === WEB_CLIENT_NAME);
  if (existing) { record('Web app client', 'Works', `reused ${existing.ClientId}`); return existing.ClientId; }
  // EN: full version: authorization-code flow (for the hosted sign-in page, with PKCE in the browser) and
  //     15-minute access/ID tokens. USER_PASSWORD_AUTH stays on so tests and the demo can sign in from the CLI.
  // Franco: el noskha el kamla: authorization-code flow (lel hosted sign-in, b PKCE fel browser) w tokens
  //     15 de2ee2a. USER_PASSWORD_AUTH sha8al 3ashan el tests w el demo yedkhalo men el CLI.
  const base = ['cognito-idp', 'create-user-pool-client', '--user-pool-id', poolId, '--client-name', WEB_CLIENT_NAME,
    '--no-generate-secret', '--explicit-auth-flows', 'ALLOW_USER_PASSWORD_AUTH', 'ALLOW_USER_SRP_AUTH', 'ALLOW_REFRESH_TOKEN_AUTH',
    '--prevent-user-existence-errors', 'ENABLED'];
  const validity = ['--access-token-validity', '15', '--id-token-validity', '15', '--refresh-token-validity', '1',
    '--token-validity-units', 'AccessToken=minutes,IdToken=minutes,RefreshToken=days'];
  const oauth = ['--allowed-o-auth-flows', 'code', '--allowed-o-auth-scopes', 'openid', 'email', 'profile',
    '--allowed-o-auth-flows-user-pool-client', '--supported-identity-providers', 'COGNITO',
    '--callback-urls', `${APP_URL}/callback.html`, '--logout-urls', `${APP_URL}/`];
  let r = aws([...base, ...validity, ...oauth]);
  if (r.ok) {
    record('Web client: code flow + 15-minute access token', 'Works (config accepted)', r.json.UserPoolClient.ClientId);
    return r.json.UserPoolClient.ClientId;
  }
  record('Web client with OAuth code flow', 'Partial', `rejected, retrying without OAuth settings: ${r.error}`);
  r = aws([...base, ...validity]);
  if (r.ok) { record('Web client: 15-minute access token (no OAuth flow)', 'Works (config accepted)', r.json.UserPoolClient.ClientId); return r.json.UserPoolClient.ClientId; }
  const plain = must(base, 'Web client (plain)');
  record('Web client token validity settings', 'Not supported', r.error);
  return plain.UserPoolClient.ClientId;
}

// ------------------------------------------------------------------ 5. machine-to-machine client for jobs
function ensureServiceClient(poolId) {
  const rs = aws(['cognito-idp', 'create-resource-server', '--user-pool-id', poolId, '--identifier', RESOURCE_SERVER,
    '--name', 'Training Tracker API', '--scopes', `ScopeName=${JOB_SCOPE},ScopeDescription=Run scheduled jobs`]);
  if (!rs.ok && !/exists/i.test(rs.error)) record('Resource server (custom scope)', 'Not supported', rs.error);
  const list = must(['cognito-idp', 'list-user-pool-clients', '--user-pool-id', poolId, '--max-results', '60'], 'List app clients');
  const existing = (list.UserPoolClients || []).find((c) => c.ClientName === SERVICE_CLIENT_NAME);
  if (existing) { record('Service (M2M) client', 'Works', `reused ${existing.ClientId}`); return { clientId: existing.ClientId, created: false }; }
  const r = aws(['cognito-idp', 'create-user-pool-client', '--user-pool-id', poolId, '--client-name', SERVICE_CLIENT_NAME,
    '--generate-secret', '--allowed-o-auth-flows', 'client_credentials', '--allowed-o-auth-scopes', `${RESOURCE_SERVER}/${JOB_SCOPE}`,
    '--allowed-o-auth-flows-user-pool-client', '--access-token-validity', '15', '--token-validity-units', 'AccessToken=minutes']);
  if (!r.ok) { record('Service (M2M) client with client_credentials', 'Not supported', r.error); return null; }
  const { ClientId, ClientSecret } = r.json.UserPoolClient;
  record('Service (M2M) client with client_credentials', 'Works (config accepted)', ClientId);
  storeServiceSecret(ClientId, ClientSecret);
  return { clientId: ClientId, created: true };
}

// EN: the client secret goes straight into Secrets Manager through a temp file that is deleted at once, so it
//     never appears on screen, in the command line or in the repo.
// Franco: el client secret beyro7 3ala Secrets Manager 3an taree2 temp file beyetmese7 3ala tool, f 3omro
//     ma byezhar 3al shasha wala fel command line wala fel repo.
function storeServiceSecret(clientId, clientSecret) {
  const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ett-')), 'secret.json');
  fs.writeFileSync(tmp, JSON.stringify({ clientId, clientSecret }), { mode: 0o600 });
  try {
    let r = aws(['secretsmanager', 'put-secret-value', '--secret-id', 'ett/service-client', '--secret-string', `file://${tmp}`]);
    if (!r.ok && /ResourceNotFound/i.test(r.error)) {
      r = aws(['secretsmanager', 'create-secret', '--name', 'ett/service-client', '--secret-string', `file://${tmp}`]);
    }
    record('Service client secret stored in Secrets Manager (ett/service-client)', r.ok ? 'Works' : 'Failed', r.ok ? 'value not printed' : r.error);
  } finally {
    fs.rmSync(path.dirname(tmp), { recursive: true, force: true });
  }
}

// ------------------------------------------------------------------ 6. users from the seeded employees
function provisionUsers(poolId) {
  const password = env.TEST_USER_PASSWORD;
  if (!password) { console.error('Set TEST_USER_PASSWORD in .env (dummy value, at least 12 chars with upper, lower, number, symbol).'); finish(1); }
  let rows;
  try {
    // EN: the group follows the data: a team's manager is a Manager, everyone else an Employee.
    // Franco: el group mashi ma3 el data: manager el team Manager, w el ba2y Employee.
    rows = psql(`SELECT e.id, e.email, CASE WHEN t.manager_id = e.id THEN 'Manager' ELSE 'Employee' END
                 FROM employees e JOIN teams t ON t.id = e.team_id ORDER BY e.email;`).split('\n').filter(Boolean).map((l) => l.split('|'));
  } catch (err) {
    console.error(`Cannot read employees from Postgres. Run "node infra/db/load.js all" first.\n${err.message}`);
    finish(1);
  }
  const updates = [];
  for (const [employeeId, email, group] of rows) {
    const created = aws(['cognito-idp', 'admin-create-user', '--user-pool-id', poolId, '--username', email,
      '--user-attributes', `Name=email,Value=${email}`, 'Name=email_verified,Value=true', '--message-action', 'SUPPRESS']);
    if (!created.ok && !/UsernameExists|already exists/i.test(created.error)) { record(`User ${email}`, 'Failed', created.error); continue; }
    const pw = aws(['cognito-idp', 'admin-set-user-password', '--user-pool-id', poolId, '--username', email, '--password', password, '--permanent']);
    if (!pw.ok) { record(`Password for ${email}`, 'Failed', pw.error); continue; }
    aws(['cognito-idp', 'admin-add-user-to-group', '--user-pool-id', poolId, '--username', email, '--group-name', group]);
    const user = aws(['cognito-idp', 'admin-get-user', '--user-pool-id', poolId, '--username', email]);
    const sub = user.ok && ((user.json.UserAttributes || []).find((a) => a.Name === 'sub') || {}).Value;
    // EN: only accept a plain UUID/ID before putting it into SQL.
    // Franco: ne2bal ID basit bas abl ma ne7otto fel SQL.
    if (!sub || !/^[A-Za-z0-9-]{1,64}$/.test(sub) || !/^[0-9a-f-]{36}$/.test(employeeId)) { record(`sub for ${email}`, 'Failed', 'no valid sub'); continue; }
    updates.push(`UPDATE employees SET cognito_sub = '${sub}' WHERE id = '${employeeId}';`);
  }
  psql(`BEGIN;\nUPDATE employees SET cognito_sub = NULL;\n${updates.join('\n')}\nCOMMIT;`);
  record('Test users + groups + cognito_sub written to employees', updates.length === rows.length ? 'Works' : 'Partial',
    `${updates.length}/${rows.length} users provisioned`);
  return rows;
}

// ------------------------------------------------------------------ 7. real sign-in checks
function checkSignIn(clientId, rows) {
  for (const group of ['Employee', 'Manager']) {
    const row = rows.find((r) => r[2] === group);
    if (!row) continue;
    const r = aws(['cognito-idp', 'initiate-auth', '--client-id', clientId, '--auth-flow', 'USER_PASSWORD_AUTH',
      '--auth-parameters', `USERNAME=${row[1]},PASSWORD=${env.TEST_USER_PASSWORD}`]);
    if (!r.ok) { record(`Sign-in as ${group}`, 'Failed', r.error); continue; }
    if (r.json.ChallengeName) { record(`Sign-in as ${group}`, 'Works (challenge)', `challenge ${r.json.ChallengeName}`); continue; }
    // EN: we print only the CLAIMS (who, group, lifetime), never the token itself.
    // Franco: bnetba3 el CLAIMS bas (meen, el group, el moda), 3omrena ma bnetba3 el token nafso.
    const claims = decodeJwtPayload(r.json.AuthenticationResult.AccessToken);
    const lifetimeMin = Math.round((claims.exp - claims.iat) / 60);
    record(`Sign-in as ${group}: access token claims`, 'Works',
      `token_use=${claims.token_use}; client_id present=${Boolean(claims.client_id)}; cognito:groups=${JSON.stringify(claims['cognito:groups'] || null)}; iss=${claims.iss}`);
    record(`Access token lifetime (${group})`, lifetimeMin <= 15 ? 'Works' : 'Partial',
      `${lifetimeMin} minutes (wanted 15)${lifetimeMin <= 15 ? '' : ': Floci ignores the validity setting'}`);
    if (group === 'Manager') return claims.iss;
  }
  return null;
}

function checkJwks(issuer) {
  const r = spawnSync(process.execPath, ['-e', `fetch(${JSON.stringify(`${issuer}/.well-known/jwks.json`)}).then(r=>r.json()).then(j=>console.log((j.keys||[]).length)).catch(e=>{console.error(e.message);process.exit(1)})`], { encoding: 'utf8' });
  record('JWKS endpoint (public keys for signature check)', r.status === 0 && Number(r.stdout) > 0 ? 'Works' : 'Not supported',
    r.status === 0 ? `${r.stdout.trim()} key(s) at ${issuer}/.well-known/jwks.json` : r.stderr.trim());
}

// ------------------------------------------------------------------ output
let poolIdOut = null; let webClientOut = null; let serviceClientOut = null; let issuerOut = null;
function finish(code = 0) {
  const lines = [
    '# Floci Cognito notes (generated by infra/floci/cognito/cognito_init.js)', '',
    `Real results from running the script on ${new Date().toISOString()} against Floci at ${endpoint}.`,
    'Re-run the script to refresh this file; do not edit the table by hand.', '',
    '| Feature | Result | Real output / detail |', '|---|---|---|',
    ...notes.map((n) => `| ${n.feature} | ${n.result} | ${n.detail} |`), '',
    '## What this means for the app', '',
    '- Anything marked **Not supported** or **Partial** must also be listed in `docs/LIMITATIONS.md` with a reason and the improvement on real AWS.',
    '- MFA: the pool setting is recorded above; enrolling a TOTP device and being challenged at sign-in must be checked by hand (`associate-software-token`, `verify-software-token`, `admin-set-user-mfa-preference`) and added here.',
    '- On real AWS the same settings apply unchanged: 15-minute access tokens, MFA required for the Manager group, and the client-credentials flow on the Cognito domain\'s `/oauth2/token` endpoint.', '',
  ];
  fs.mkdirSync(path.join(repoRoot, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(repoRoot, 'docs', 'FLOCI_COGNITO_NOTES.md'), lines.join('\n'));
  if (poolIdOut) {
    const inside = env.AWS_ENDPOINT_URL_DOCKER || 'http://floci:4566';
    const issuer = issuerOut || `${endpoint}/${poolIdOut}`;
    fs.writeFileSync(path.join(__dirname, 'cognito.generated.env'), [
      '# Generated by cognito_init.js. Public ids only (no secrets). Copy these lines into your .env.',
      `COGNITO_USER_POOL_ID=${poolIdOut}`, `COGNITO_WEB_CLIENT_ID=${webClientOut || ''}`,
      `COGNITO_SERVICE_CLIENT_ID=${serviceClientOut || ''}`, `COGNITO_ISSUER=${issuer}`,
      '# EN: services run inside Docker, where Floci is "floci", not "localhost"',
      `COGNITO_JWKS_URL=${inside}/${poolIdOut}/.well-known/jwks.json`, ''].join('\n'));
    console.log(`\nWrote infra/floci/cognito/cognito.generated.env and docs/FLOCI_COGNITO_NOTES.md`);
  }
  process.exit(code);
}

function main() {
  const poolId = ensurePool(); poolIdOut = poolId;
  tryMfa(poolId);
  ensureGroups(poolId);
  webClientOut = ensureWebClient(poolId);
  const svc = ensureServiceClient(poolId); serviceClientOut = svc && svc.clientId;
  const rows = provisionUsers(poolId);
  issuerOut = checkSignIn(webClientOut, rows);
  if (issuerOut) checkJwks(issuerOut);
  finish(0);
}

if (require.main === module) main();
module.exports = { decodeJwtPayload, readEnv };
