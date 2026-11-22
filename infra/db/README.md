# infra/db: database schema, roles, seed and checks

Owner: Kerolus. PostgreSQL 13 or newer (psql 15+ for `roles.sql`). Each table belongs to exactly one service, and each service logs in with its own role that can only reach its own tables.

| File | What it does |
|---|---|
| `schema.sql` | All tables, constraints, indexes and the three least-privilege roles `svc_s1`, `svc_s2`, `svc_s3`. Safe to run twice. |
| `roles.sql` | Gives the three roles a login password, read from `DB_S1_PASSWORD`, `DB_S2_PASSWORD` and `DB_S3_PASSWORD`. No password is ever in the repo. |
| `seed.sql` | **Wipes** all tables, then creates 2 teams, 2 managers, 6 employees, 8 trainings, 17 assignments in every state and 5 certificates. Prints the test users. Dates are relative to today. |
| `checks.sql` | 11 database tests: the duplicate-open-assignment rule, the date and file checks, one snapshot per day, least privilege per role, and that the seed covers every state. Everything is rolled back. |
| `load.js` | Runs the files above inside the compose Postgres container. Uses only Node built-ins, so it works in PowerShell. |

## Quick start (PowerShell, from the repo root, with `docker compose up -d` running)

Add these to your local `.env`. It is git-ignored; use any values you like:

```
DB_S1_PASSWORD=change-me-s1
DB_S2_PASSWORD=change-me-s2
DB_S3_PASSWORD=change-me-s3
# optional, only if the compose file uses other names:
POSTGRES_SERVICE=postgres
POSTGRES_USER=postgres
POSTGRES_DB=training
```

Then:

```powershell
node infra/db/load.js all      # schema + roles + seed + checks
node infra/db/load.js seed     # reset the test data at any time
node infra/db/load.js checks   # re-run the database tests
```

Expected end of the output: `PASS T-DB1` to `PASS T-DB11`, then `All database checks passed.`

## Tables per service

| Service | Tables | Role | Privileges |
|---|---|---|---|
| S1 Employee & Training | teams, employees, trainings, assignments | `svc_s1` | SELECT, INSERT, UPDATE (no DELETE: assignments are history) |
| S2 Certificate & Compliance | certificates, compliance_flags, audit_log | `svc_s2` | SELECT, INSERT, UPDATE; audit_log only SELECT + INSERT (append-only) |
| S3 Dashboard & Reports | compliance_snapshots, report_runs | `svc_s3` | SELECT, INSERT, UPDATE on snapshots; SELECT, INSERT, DELETE on report_runs |

## Rules enforced by the database itself

- **One open assignment per training.** A partial unique index on `assignments(employee_id, training_id) WHERE completed_at IS NULL` blocks a second one. The API returns 409.
- **No stored status.** Assigned, Completed and Overdue are calculated on read: Overdue means `due_date < today` and not completed.
- **Certificate checks.** `issue_date <= expiry_date`, the file is at most 5 MB, and the MIME type must be PDF, JPEG or PNG.
- **One open flag per type.** Only one open flag of each type per employee and training.
- **One snapshot per day.** Only one compliance snapshot per employee per day.
- **No cross-service foreign keys.** Foreign keys exist only inside one service's own tables. For example, `certificates.employee_id` is checked by S2 through S1's API.

## Seeded test users

| E-mail | Name | Team | Cognito group |
|---|---|---|---|
| mona.manager@example.com | Mona Hassan | Operations | Manager |
| ahmed@example.com | Ahmed Ali | Operations | Employee |
| sara@example.com | Sara Mahmoud | Operations | Employee |
| youssef@example.com | Youssef Adel | Operations | Employee |
| omar.manager@example.com | Omar Fathy | Laboratory | Manager |
| hana@example.com | Hana Mostafa | Laboratory | Employee |
| nour@example.com | Nour Ibrahim | Laboratory | Employee |
| tarek@example.com | Tarek Samir | Laboratory | Employee |

**Demo states in the seed:**
- **Ahmed:** one assignment overdue and one due today.
- **Sara:** completed on time, with a valid certificate and a renewal.
- **Youssef:** completed late, with a certificate expiring soon. His First Aid is completed but has no certificate (Missing).
- **Nour:** her certificate expired, and her renewal is overdue.
- **Hana:** one future assignment and one recently completed.
- **Tarek:** overdue since yesterday. His First Aid certificate is still Pending, after an earlier one was Rejected.

Seed certificates point to no real file in S3, so only certificates uploaded through the app can be downloaded.
