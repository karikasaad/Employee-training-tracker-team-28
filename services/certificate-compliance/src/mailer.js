// EN: Sends e-mail through SendGrid. The API key is a SECRET: it comes from the environment (optional, for local
//     tests) or from AWS Secrets Manager (ett/sendgrid). It is never written to a log, an error or a response.
//     No real key (empty or the local placeholder) = the e-mail is skipped and "email skipped" is logged.
// Franco: Beyeb3at e-mail 3an taree2 SendGrid. El API key SECRET: gai men el environment (ekhteyari, lel tagareb el
//     local) aw men AWS Secrets Manager (ett/sendgrid). 3omro ma yet-kteb fel log wala error wala response.
//     Mafeesh key 7a2i2i (fadi aw el placeholder el local) = el e-mail beyetgaheel w bey-etkteb "email skipped".
'use strict';

const SENDGRID_URL = 'https://api.sendgrid.com/v3/mail/send';

// EN: real SendGrid keys start with "SG."; the local placeholder "REPLACE_ME..." does not.
// Franco: el SendGrid keys el 7a2i2eya btebda2 b "SG."; el placeholder el local "REPLACE_ME..." la2.
const isRealKey = (value) => typeof value === 'string' && value.trim().startsWith('SG.');

// EN: find the key: environment first, then Secrets Manager. Any problem = no key (never a crash, never a leak).
// Franco: nelaqi el key: el environment el awel, ba3dein Secrets Manager. Ay moshkela = mafeesh key (mesh crash w mesh tasreeb).
async function keyFromEnvOrSecret() {
  const fromEnv = process.env.SENDGRID_API_KEY;
  if (isRealKey(fromEnv)) return fromEnv.trim();
  try {
    const { SecretsManagerClient, GetSecretValueCommand } = require('@aws-sdk/client-secrets-manager');
    const client = new SecretsManagerClient({
      region: process.env.AWS_DEFAULT_REGION || 'us-east-1',
      endpoint: process.env.AWS_ENDPOINT_URL || undefined,
    });
    const out = await client.send(new GetSecretValueCommand({ SecretId: process.env.SENDGRID_SECRET_ID || 'ett/sendgrid' }));
    return isRealKey(out.SecretString) ? out.SecretString.trim() : null;
  } catch {
    return null;
  }
}

function createMailer({
  logger, getKey = keyFromEnvOrSecret, fetchImpl = globalThis.fetch, fromEmail = process.env.SENDGRID_FROM_EMAIL || 'noreply@example.com',
}) {
  // EN: returns 'sent', 'skipped' (no key) or 'failed' (SendGrid refused or is unreachable).
  // Franco: beyrga3 'sent' aw 'skipped' (mafeesh key) aw 'failed' (SendGrid rafad aw mesh mawgood).
  async function send({ to, subject, text }) {
    const key = await getKey();
    if (!key) {
      logger.warn('email_skipped', { message: 'email skipped: no SendGrid key is set' });
      return 'skipped';
    }
    let res;
    try {
      res = await fetchImpl(SENDGRID_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          personalizations: [{ to: [{ email: to }] }],
          from: { email: fromEmail },
          subject,
          content: [{ type: 'text/plain', value: text }],
        }),
        signal: AbortSignal.timeout(5000),
      });
    } catch {
      logger.error('email_failed', { message: 'SendGrid is not reachable' });
      return 'failed';
    }
    if (!res.ok) {
      logger.error('email_failed', { message: 'SendGrid refused the e-mail', status: res.status });
      return 'failed';
    }
    return 'sent';
  }

  return { send };
}

module.exports = { createMailer, isRealKey };
