// EN: Cognito spike: tests on Floci what the project NEEDS from Cognito and writes the REAL answers into
//     docs/FLOCI_SPIKE.md (section "Cognito spike"). Nothing is typed by hand. It checks:
//       1. the "cognito:groups" claim in the access token (Employee and Manager)
//       2. the access token lifetime (wanted: 15 minutes)
//       3. MFA (TOTP) for a manager: enrol, sign in again, get the challenge, wrong code, right code
//       4. MFA required at pool level (a temporary pool, deleted at the end)
//       5. GlobalSignOut: do the access token and the refresh token stop working?
//     It creates two temporary users (and one temporary pool) and deletes them at the end. Tokens, secrets and
//     codes are NEVER printed or written: only claims, lengths and error texts.
//     Needs the same as cognito_init.js: Floci running, the AWS CLI, and TEST_USER_PASSWORD in .env.
//     Run (repo root, after cognito_init.js):  node infra/floci/cognito/cognito_spike.js
// Franco: Cognito spike: bey-test 3ala Floci elly el project me7tago men Cognito w beyekteb el ejabat el 7a2i2eya
//     fe docs/FLOCI_SPIKE.md (section "Cognito spike"). Mafeesh 7aga betetketeb b-eed. Beyfa7as:
//       1. claim "cognito:groups" fel access token (Employee w Manager)
//       2. 3omr el access token (el matloob: 15 de2ee2a)
//       3. MFA (TOTP) lel manager: ye3mel enrol, yedkhol tany, ye5od el challenge, code ghalat, code sa7
//       4. MFA egbary 3ala mostawa el pool (pool mo2aqqata, betetmese7 fel a5er)
//       5. GlobalSignOut: el access token w el refresh token beyewa22afo walla la?
//     Beye3mel 2 users mo2aqqatin (w pool mo2aqqata) w beymse7hom fel a5er. El tokens w el secrets w el codes
//     3omrena ma betetba3 wala betetketeb: el claims w el tool w nos el errors bas.
//     Me7tag nafs cognito_init.js: Floci shaghal, el AWS CLI, w TEST_USER_PASSWORD fe .env.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { readEnv, decodeJwtPayload } = require('./cognito_init');
const { totp } = require('./totp');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const env = { ...readEnv(path.join(__dirname, 'cognito.generated.env')), ...readEnv(path.join(repoRoot, '.env')) };
const endpoint = env.AWS_ENDPOINT_URL_HOST || 'http://localhost:4566';
const awsEnv = { ...process.env, ...env, AWS_ENDPOINT_URL: endpoint, AWS_DEFAULT_REGION: env.AWS_DEFAULT_REGION || 'us-east-1',
  AWS_ACCESS_KEY_ID: env.FLOCI_ACCESS_KEY_ID || 'test', AWS_SECRET_ACCESS_KEY: env.FLOCI_SECRET_ACCESS_KEY || 'test', AWS_PAGER: '' };
const OUT = path.join(repoRoot, 'docs', 'FLOCI_SPIKE.md');
const START = '<!-- cognito-spike:start -->';
const END = '<!-- cognito-spike:end -->';

// EN: one AWS CLI call; never throws. / Franco: call wa7ed le AWS CLI; mabyermeesh error.
function aws(args) {
  const r = spawnSync('aws', [...args, '--output', 'json'], { env: awsEnv, encoding: 'utf8' });
  if (r.error) return { ok: false, error: `cannot run aws CLI: ${r.error.message}` };
  if (r.status !== 0) return { ok: false, error: (r.stderr || '').trim() || `exit ${r.status}` };
  try { return { ok: true, json: r.stdout.trim() ? JSON.parse(r.stdout) : {} }; } catch { return { ok: true, json: {} }; }
}
const idp = (...args) => aws(['cognito-idp', ...args]);

const results = []; // EN: { check, result, evidence, decision } / Franco: el natayeg
const clean = (t) => String(t).replace(/\|/g, '/').replace(/\s+/g, ' ').slice(0, 260);
function record(check, ok, evidence, decisionOk, decisionNot) {
  const result = ok === true ? 'Works' : ok === 'partial' ? 'Partial' : 'Not supported';
  results.push({ check, result, evidence: clean(evidence), decision: ok === true ? decisionOk : decisionNot });
  console.log(`[${result}] ${check}: ${clean(evidence).slice(0, 140)}`);
}

const PASSWORD = env.TEST_USER_PASSWORD;
const signIn = (clientId, username) => idp('initiate-auth', '--client-id', clientId, '--auth-flow', 'USER_PASSWORD_AUTH',
  '--auth-parameters', `USERNAME=${username},PASSWORD=${PASSWORD}`);
const minutesLeft = (claims) => Math.round((claims.exp * 1000 - Date.now()) / 60000);

function makeUser(poolId, username, group) {
  idp('admin-create-user', '--user-pool-id', poolId, '--username', username, '--user-attributes', `Name=email,Value=${username}`,
    'Name=email_verified,Value=true', '--message-action', 'SUPPRESS');
  const pw = idp('admin-set-user-password', '--user-pool-id', poolId, '--username', username, '--password', PASSWORD, '--permanent');
  if (group) idp('admin-add-user-to-group', '--user-pool-id', poolId, '--username', username, '--group-name', group);
  return pw.ok;
}

// ------------------------------------------------------------------ 1 + 2: groups claim and lifetime
function checkClaims(clientId, who, username, group) {
  const r = signIn(clientId, username);
  if (!r.ok || !r.json.AuthenticationResult) {
    record(`Sign-in as ${who}`, false, r.ok ? `challenge ${r.json.ChallengeName}` : r.error, '', 'Cannot test the claims; fix the sign-in first.');
    return null;
  }
  const tokens = r.json.AuthenticationResult;
  const claims = decodeJwtPayload(tokens.AccessToken);
  const groups = claims['cognito:groups'] || [];
  record(`Groups in the access token (${who})`, groups.length === 1 && groups[0] === group,
    `cognito:groups=${JSON.stringify(groups)}; token_use=${claims.token_use}; client_id present=${Boolean(claims.client_id)}`,
    'Services read the role from this claim (common/auth.js); the backend checks it on every request.',
    'Do not trust the role from the frontend. Fallback: look the role up in the employees table.');
  const minutes = Math.round((claims.exp - claims.iat) / 60);
  record(`Access token lifetime (${who})`, minutes === 15, `${minutes} minutes (wanted 15)`,
    'Keep 15 minutes in the pool client; the same setting applies unchanged on real AWS.',
    'Floci ignores the validity setting; on AWS set AccessTokenValidity=15 minutes in the app client.');
  record(`Refresh token returned (${who})`, Boolean(tokens.RefreshToken), tokens.RefreshToken ? 'present (value not printed)' : 'missing',
    'Used by GlobalSignOut test below.', 'Sessions cannot be renewed; users sign in again every 15 minutes.');
  return tokens;
}

// ------------------------------------------------------------------ 3: MFA (TOTP) for a manager
function checkManagerMfa(poolId, clientId, username, firstTokens) {
  const cfg = idp('get-user-pool-mfa-config', '--user-pool-id', poolId);
  record('MFA configuration can be read back', cfg.ok,
    cfg.ok ? `MfaConfiguration=${cfg.json.MfaConfiguration}; software token enabled=${JSON.stringify((cfg.json.SoftwareTokenMfaConfiguration || {}).Enabled)}` : cfg.error,
    'The pool has TOTP MFA switched on; managers are then enrolled one by one.', 'Set MFA by hand in the AWS console and record a screenshot.');

  const assoc = idp('associate-software-token', '--access-token', firstTokens.AccessToken);
  const secret = assoc.ok && assoc.json.SecretCode;
  record('MFA: manager can start TOTP enrolment (associate-software-token)', Boolean(secret),
    secret ? `secret received (${secret.length} characters, not printed)` : assoc.error,
    'A manager scans the secret as a QR code in an authenticator app.', 'MFA enrolment cannot be demonstrated on Floci; show it on a real Cognito pool.');
  if (!secret) return;

  const verify = idp('verify-software-token', '--access-token', firstTokens.AccessToken, '--user-code', totp(secret), '--friendly-device-name', 'spike');
  record('MFA: the right 6-digit code finishes enrolment (verify-software-token)', verify.ok && verify.json.Status === 'SUCCESS',
    verify.ok ? `Status=${verify.json.Status}` : verify.error,
    'The device is registered.', 'Floci does not check TOTP codes the way AWS does; the check is only possible on real AWS.');

  const pref = idp('admin-set-user-mfa-preference', '--user-pool-id', poolId, '--username', username,
    '--software-token-mfa-settings', 'Enabled=true,PreferredMfa=true');
  record('MFA: set TOTP as the manager\'s preferred method', pref.ok, pref.ok ? 'accepted' : pref.error,
    'From now on this manager is asked for a code at every sign-in.', 'Rely on the pool-level setting instead (see the next check).');

  const second = signIn(clientId, username);
  const challenge = second.ok && second.json.ChallengeName;
  record('MFA: signing in again returns a SOFTWARE_TOKEN_MFA challenge (no tokens yet)', challenge === 'SOFTWARE_TOKEN_MFA' && !second.json.AuthenticationResult,
    second.ok ? `ChallengeName=${challenge || 'none'}; tokens returned=${Boolean(second.json.AuthenticationResult)}` : second.error,
    'The frontend asks for the 6-digit code (auth.js already handles this step).',
    'Floci signs the manager in WITHOUT the code. MFA for managers can only be enforced on real AWS; list it in LIMITATIONS.md.');
  if (challenge !== 'SOFTWARE_TOKEN_MFA') return;

  const login = (code) => idp('respond-to-auth-challenge', '--client-id', clientId, '--challenge-name', 'SOFTWARE_TOKEN_MFA', '--session', second.json.Session,
    '--challenge-responses', `USERNAME=${(second.json.ChallengeParameters || {}).USER_ID_FOR_SRP || username},SOFTWARE_TOKEN_MFA_CODE=${code}`);
  const good = totp(secret);
  const wrong = login(good === '000000' ? '111111' : '000000');
  record('MFA: a wrong code is rejected', !wrong.ok, wrong.ok ? 'a wrong code was ACCEPTED' : wrong.error,
    'A stolen password alone is not enough for a manager.', 'Floci accepts any code: MFA cannot be proven here, only on real AWS.');
  const right = login(good);
  const claims = right.ok && right.json.AuthenticationResult ? decodeJwtPayload(right.json.AuthenticationResult.AccessToken) : null;
  record('MFA: the right code returns tokens that still carry the Manager group', Boolean(claims) && (claims['cognito:groups'] || []).includes('Manager'),
    claims ? `cognito:groups=${JSON.stringify(claims['cognito:groups'])}` : right.error,
    'After MFA the app works exactly as before.', 'Cannot show the full MFA sign-in on Floci.');
}

// ------------------------------------------------------------------ 4: MFA required at pool level (temporary pool)
function checkRequiredMfa() {
  const created = idp('create-user-pool', '--pool-name', 'ett-spike-mfa-required', '--mfa-configuration', 'ON',
    '--software-token-mfa-configuration', 'Enabled=true', '--username-attributes', 'email');
  if (!created.ok) {
    record('MFA required at pool level (MfaConfiguration=ON)', false, created.error, '', 'Required MFA cannot be tested on Floci. On AWS use a separate user pool for managers, or require MFA for the whole pool.');
    return null;
  }
  const poolId = created.json.UserPool.Id;
  try {
    const client = idp('create-user-pool-client', '--user-pool-id', poolId, '--client-name', 'spike', '--no-generate-secret',
      '--explicit-auth-flows', 'ALLOW_USER_PASSWORD_AUTH', 'ALLOW_REFRESH_TOKEN_AUTH');
    const username = 'spike-required@example.com';
    makeUser(poolId, username, null);
    const r = client.ok ? signIn(client.json.UserPoolClient.ClientId, username) : client;
    const shown = r.ok ? `ChallengeName=${r.json.ChallengeName || 'none'}; tokens returned=${Boolean(r.json.AuthenticationResult)}` : r.error;
    record('MFA required at pool level: a user with no TOTP device cannot get tokens', r.ok && !r.json.AuthenticationResult && /MFA_SETUP|SOFTWARE_TOKEN_MFA/.test(r.json.ChallengeName || ''), shown,
      'Cognito cannot require MFA for one GROUP: on AWS MFA is required for the whole pool (managers and employees), or managers get their own pool.',
      'Floci does not enforce required MFA. On AWS set MFA to Required for the pool (or a separate manager pool).');
  } finally {
    idp('delete-user-pool', '--user-pool-id', poolId);
  }
  return poolId;
}

// ------------------------------------------------------------------ 5: GlobalSignOut
function checkSignOut(clientId, username) {
  const r = signIn(clientId, username);
  if (!r.ok || !r.json.AuthenticationResult) { record('GlobalSignOut', false, r.ok ? `challenge ${r.json.ChallengeName}` : r.error, '', 'Could not sign in to test the sign-out.'); return; }
  const { AccessToken, RefreshToken } = r.json.AuthenticationResult;
  const before = idp('get-user', '--access-token', AccessToken);
  const out = idp('global-sign-out', '--access-token', AccessToken);
  record('GlobalSignOut is accepted', out.ok, out.ok ? 'accepted' : out.error, 'The Sign out button calls it (auth.js).', 'The Sign out button still clears the tab; the refresh token stays valid on Floci.');
  const after = idp('get-user', '--access-token', AccessToken);
  record('After GlobalSignOut Cognito refuses the old access token', before.ok && !after.ok,
    `before: ${before.ok ? 'accepted' : 'refused'}; after: ${after.ok ? 'STILL accepted' : `refused (${clean(after.error).slice(0, 80)})`}`,
    'Cognito itself refuses the old token.', 'Floci keeps accepting it; on AWS it is refused.');
  const refresh = idp('initiate-auth', '--client-id', clientId, '--auth-flow', 'REFRESH_TOKEN_AUTH', '--auth-parameters', `REFRESH_TOKEN=${RefreshToken}`);
  record('After GlobalSignOut the refresh token no longer works', !refresh.ok,
    refresh.ok ? 'refresh token STILL gives new tokens' : `refused (${clean(refresh.error).slice(0, 80)})`,
    'Signing out really ends the session: nobody can get new tokens with the old refresh token.',
    'Floci still renews the session. On AWS the refresh token is revoked, which is the reason GlobalSignOut is used.');
  const left = minutesLeft(decodeJwtPayload(AccessToken));
  record('Our services still accept a signed-out access token until it expires', 'partial',
    `the old access token still has ${left} minute(s) left; services check only signature and exp`,
    'This is true on real AWS too (JWTs are checked offline). The 15-minute lifetime limits the risk; list it in LIMITATIONS.md.',
    'Same as above.');
}

// ------------------------------------------------------------------ write into docs/FLOCI_SPIKE.md
function writeReport() {
  const stamp = new Date().toISOString().replace('T', ' ').slice(0, 16);
  const block = [START, '## Cognito spike', '',
    `Generated by \`infra/floci/cognito/cognito_spike.js\` on ${stamp} UTC against \`${endpoint}\`. Every result comes from the real run; tokens, secrets and codes are never printed.`, '',
    '| Check | Result | Evidence (real output) | Workaround / decision |', '| --- | --- | --- | --- |',
    ...results.map((r) => `| ${r.check} | ${r.result} | ${r.evidence} | ${clean(r.decision)} |`), '', END].join('\n');
  let text = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '# Floci spike\n';
  const a = text.indexOf(START); const b = text.indexOf(END);
  text = a >= 0 && b > a ? text.slice(0, a) + block + text.slice(b + END.length) : `${text.replace(/\s*$/, '')}\n\n${block}\n`;
  fs.writeFileSync(OUT, text);
  console.log(`\nWrote the Cognito section of ${path.relative(repoRoot, OUT)}`);
}

function main() {
  const poolId = env.COGNITO_USER_POOL_ID; const clientId = env.COGNITO_WEB_CLIENT_ID;
  if (!PASSWORD || !poolId || !clientId) {
    console.error('Run node infra/floci/cognito/cognito_init.js first and set TEST_USER_PASSWORD in .env (needs COGNITO_USER_POOL_ID and COGNITO_WEB_CLIENT_ID).');
    process.exit(1);
  }
  const manager = 'spike-manager@example.com'; const employee = 'spike-employee@example.com';
  try {
    if (!makeUser(poolId, manager, 'Manager') || !makeUser(poolId, employee, 'Employee')) { console.error('Cannot create the spike users on Floci.'); process.exit(1); }
    checkClaims(clientId, 'Employee', employee, 'Employee');
    const managerTokens = checkClaims(clientId, 'Manager', manager, 'Manager');
    if (managerTokens) checkManagerMfa(poolId, clientId, manager, managerTokens);
    checkRequiredMfa();
    // EN: use the employee for the sign-out test, because the manager now needs an MFA code.
    // Franco: bnesta3mel el employee le test el sign-out, 3ashan el manager delwa2ty me7tag code MFA.
    checkSignOut(clientId, employee);
  } finally {
    for (const u of [manager, employee]) idp('admin-delete-user', '--user-pool-id', poolId, '--username', u);
  }
  writeReport();
}

main();
