# services/common: shared code for S1, S2 and S3

Owner: Kerolus. It has **no npm dependencies**: only Node 20+ built-ins. Each service installs `express` and `pg` itself and passes them in. Run the tests with `npm test` in this folder (`node --test`).

| File | What it gives you |
|---|---|
| `auth.js` | `createAuth()` → `requireAuth(roles)` Express middleware and `verifyToken()`. It checks the Cognito access token: RS256 signature against the JWKS, `iss`, `client_id`, `token_use = access` and `exp`. A token problem gives 401; a wrong role gives 403. It also exports `isServiceToken`, `hasRole` and `getServiceToken` (client credentials, for jobs). |
| `db.js` | `createDb({ pool })` → `query`, `queryOne`, `withTransaction`, with guard rails: no quotes in the SQL text, one statement only, and `$n` must match the params. Also `poolConfigFromEnv()` and the Postgres error codes `PG`. |
| `logging.js` | `createLogger(service)` writes JSON lines with secrets redacted. Also `requestIdMiddleware` (`X-Request-Id`) and `requestLogger`, which logs 401 as `auth_failure` and 403 as `forbidden` at level warn. |
| `errors.js` | `HttpError` and helpers (`badRequest`, `forbidden`, `notFound`, `conflict`…), `fromDbError` (23505 → 409, 22P02 → 400), `notFoundHandler` and `errorHandler`. Every error has the contract shape `{ "error": { "code", "message", "details?" } }`. |

## How a service wires it (example for S1)

```js
// services/employee-training/src/app.js
const express = require('express');
const { Pool } = require('pg');
const { createAuth } = require('../../common/auth');
const { createDb, poolConfigFromEnv } = require('../../common/db');
const { createLogger, requestIdMiddleware, requestLogger } = require('../../common/logging');
const { errorHandler, notFoundHandler, notFound } = require('../../common/errors');

const logger = createLogger('employee-training');
const db = createDb({ pool: new Pool(poolConfigFromEnv()) });          // logs in as svc_s1
const auth = createAuth({
  // S1 only: map the Cognito sub to employees.id (other services call GET /api/employees/me instead)
  resolveEmployeeId: async (sub) => {
    const row = await db.queryOne('SELECT id FROM employees WHERE cognito_sub = $1', [sub]);
    if (!row) throw notFound('No employee profile for this user');
    return row.id;
  },
});

const app = express();
app.disable('x-powered-by');
app.use(requestIdMiddleware);
app.use(requestLogger(logger));
app.use(express.json({ limit: '100kb' }));                            // too big -> 413 via errorHandler

app.get('/health', (req, res) => res.json({ status: 'ok', service: 'employee-training' }));
app.get('/api/trainings', auth.requireAuth(['Employee', 'Manager']), async (req, res, next) => {
  try {
    res.json(await db.query('SELECT id, name, category FROM trainings WHERE category = $1', [req.query.category]));
  } catch (err) { next(err); }
});
app.post('/api/trainings', auth.requireAuth(['Manager']), /* ... */);
app.post('/api/compliance/run-check', auth.requireAuth(['Service']), /* S2 job route */);

app.use(notFoundHandler);
app.use(errorHandler(logger));                                        // must be last
module.exports = app;
```

**Docker note for Karim's Dockerfiles:** a service imports `../../common/...`, so the build context must be the repo root, or the `services/` folder. Copy `services/common` next to the service in the image, for example:

```dockerfile
COPY services/common /app/services/common
COPY services/employee-training /app/services/employee-training
```

## Environment variables

| Variable | Used by | Example (Floci) |
|---|---|---|
| `COGNITO_ISSUER` | auth.js | `http://localhost:4566/us-east-1_xxxxx`, the exact `iss` in the tokens (see `infra/floci/cognito/cognito.generated.env`) |
| `COGNITO_WEB_CLIENT_ID` | auth.js | the web client id (comma-separated if there are several) |
| `COGNITO_SERVICE_CLIENT_ID` | auth.js | the jobs client id (gives the `Service` role) |
| `COGNITO_JWKS_URL` | auth.js | `http://floci:4566/us-east-1_xxxxx/.well-known/jwks.json`, as reached from inside Docker |
| `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`, `DB_SSL` | db.js | `postgres`, `5432`, `training`, `svc_s1`, *(from .env)*, `false` |
| `LOG_LEVEL` | logging.js | `info` |
