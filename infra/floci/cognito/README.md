# infra/floci/cognito: Cognito user pool on Floci

Owner: Kerolus. `cognito_init.js` calls the AWS CLI with Floci's dummy credentials, so it needs no npm packages. It is safe to run twice.

**Run it** in PowerShell, from the repo root. First run `docker compose up -d` and `node infra/db/load.js all`, and put a dummy `TEST_USER_PASSWORD=Test@12345678` in `.env`:

```powershell
node infra/floci/cognito/cognito_init.js
```

**What it creates:**
- The user pool `ett-users`: e-mail is the username, and passwords need at least 12 characters with upper, lower, number and symbol.
- TOTP MFA at the pool level (OPTIONAL), if Floci accepts it.
- The groups `Employee` and `Manager`.
- The web client `ett-web`:
  - authorization-code flow for the hosted sign-in;
  - access and ID tokens valid for **15 minutes**;
  - `USER_PASSWORD_AUTH` kept for tests and the CLI demo.
- The machine client `ett-jobs` (client credentials, scope `ett-api/jobs.run`). Its secret goes straight into Secrets Manager `ett/service-client` and is never printed.
- One user per seeded employee:
  - managers go into the `Manager` group, everyone else into `Employee`;
  - each user's Cognito `sub` is written to `employees.cognito_sub`.
- A real sign-in as one Employee and one Manager, which checks `token_use`, `client_id`, `cognito:groups`, the token lifetime and the JWKS endpoint.

**Outputs:**
- `docs/FLOCI_COGNITO_NOTES.md`: real results, marked Works, Partial or Not supported. **Commit it**: it is report evidence.
- `infra/floci/cognito/cognito.generated.env`: the pool and client ids, which are public values. Copy them into your `.env`. The file is git-ignored.
