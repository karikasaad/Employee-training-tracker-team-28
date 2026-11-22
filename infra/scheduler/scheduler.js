// EN: FALLBACK daily scheduler. Used only if Floci cannot run the EventBridge schedules by itself.
//     It gets a service token (Cognito client credentials) and calls the two daily jobs:
//     01:00 UTC -> S2 run-check, 01:30 UTC -> S3 run-snapshot.
// Franco: scheduler badeel. Beyet-est3mel law Floci mayeqdarsh yeshaghal el schedules.
//     Beyakhod service token (Cognito client credentials) w beyenadi el job-een el yomeyeen:
//     01:00 UTC -> S2 run-check, 01:30 UTC -> S3 run-snapshot.
//
// Usage:  node scheduler.js          (waits and runs every day)
//         node scheduler.js --now    (runs both jobs once right now, then exits - for testing)
// No dependencies: uses the fetch built into Node 20. Secrets come from environment variables, never from code.

const S2_URL = process.env.S2_URL || 'http://s2:5002';
const S3_URL = process.env.S3_URL || 'http://s3:5003';
const TOKEN_URL = process.env.TOKEN_URL || '';
const CLIENT_ID = process.env.SERVICE_CLIENT_ID || '';
const CLIENT_SECRET = process.env.SERVICE_CLIENT_SECRET || '';

const JOBS = [
  { name: 's2-run-check', hour: 1, minute: 0, url: `${S2_URL}/api/compliance/run-check` },
  { name: 's3-run-snapshot', hour: 1, minute: 30, url: `${S3_URL}/api/dashboard/run-snapshot` },
];

function log(msg, extra = {}) {
  // EN: JSON log line; never print the token or the secret. / Franco: satr log JSON; ma-nektebsh el token wala el secret.
  console.log(JSON.stringify({ time: new Date().toISOString(), service: 'scheduler', msg, ...extra }));
}

async function getServiceToken() {
  if (!TOKEN_URL || !CLIENT_ID || !CLIENT_SECRET) {
    throw new Error('TOKEN_URL, SERVICE_CLIENT_ID and SERVICE_CLIENT_SECRET must be set');
  }
  const basic = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials',
  });
  if (!res.ok) throw new Error(`token request failed with status ${res.status}`);
  const data = await res.json();
  return data.access_token;
}

async function runJob(job) {
  try {
    const token = await getServiceToken();
    const res = await fetch(job.url, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
    log('job finished', { job: job.name, status: res.status });
    return res.status;
  } catch (err) {
    log('job failed', { job: job.name, error: err.message });
    return 0;
  }
}

async function main() {
  if (process.argv.includes('--now')) {
    for (const job of JOBS) await runJob(job);
    return;
  }
  const lastRun = {}; // job name -> 'YYYY-MM-DD' of the last run, so each job runs once a day
  log('scheduler started', { jobs: JOBS.map((j) => `${j.name} at ${j.hour}:${String(j.minute).padStart(2, '0')} UTC`) });
  setInterval(async () => {
    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    for (const job of JOBS) {
      const due = now.getUTCHours() === job.hour && now.getUTCMinutes() >= job.minute;
      if (due && lastRun[job.name] !== today) {
        lastRun[job.name] = today;
        await runJob(job);
      }
    }
  }, 30 * 1000);
}

main();
