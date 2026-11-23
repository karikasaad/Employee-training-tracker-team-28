# Service 1: Employee & Training

Owner: Kerolus. Node.js + Express, port 5001. Contract: `docs/API_CONTRACT.md` section 4.

## AWS services used by this component

All are simulated by Floci locally; the same code runs on real AWS.

| AWS service | What Service 1 does with it | Code |
|---|---|---|
| **Amazon Cognito** | Every request carries a Cognito access token. S1 checks its signature against the user pool's JWKS, plus the issuer, client, `token_use` and expiry. The groups `Employee` / `Manager` are the roles. The users are created by `infra/floci/cognito/cognito_init.js`. | `services/common/auth.js`, `src/app.js` |
| **AWS Secrets Manager** | At start-up S1 reads its database login (`svc_s1` and its password) from the secret **`ett/db/s1`**. It refuses to start if the secret is missing (fail closed), and it refuses an admin login. | `src/aws.js` `loadDbConfigFromSecret`, `src/server.js` |
| **Amazon CloudWatch Logs** | Every log line goes to the log group **`/ett/s1`**, as well as to stdout. 401 is logged as `auth_failure` and 403 as `forbidden`; tokens and passwords are redacted before anything is sent. | `src/aws.js` `createCloudWatchWriter`, `services/common/logging.js` |
| **AWS IAM** (design) | The S1 role may read only its own secret and write only its own log group: `infra/iam/s1-policy.json`. Floci does not enforce IAM; see `docs/LIMITATIONS.md`. | `infra/iam/s1-policy.json` |

Secrets Manager and CloudWatch are switched on inside the Docker image (`NODE_ENV=production`). Local `npm test` runs don't need them. To switch them off, set `DB_SECRET_ID=none` / `CLOUDWATCH_LOG_GROUP=none`.

## Run locally

From the repo root, after `python scripts/dev.py up` and `python scripts/dev.py init`:

```powershell
node infra/db/load.js all                                   # tables, roles, seed, checks
node services/employee-training/scripts/put-db-secret.js    # creates ett/db/s1 in Secrets Manager (password from .env, not printed)
node infra/floci/cognito/cognito_init.js                    # Cognito users (then copy the COGNITO_ lines into .env)
python scripts/dev.py up                                    # restarts s1 so it reads the secret
```

## Tests

```powershell
cd services/employee-training
npm test                 # everything; DB tests need S1_TEST_DB_* (see test-support/helpers.js)
npm run test:security    # S1-SEC-01..21, writes docs/evidence/s1/security_results.md
```
