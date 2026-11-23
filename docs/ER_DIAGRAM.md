# ER diagram: Employee Training Tracker

Source of truth: `infra/db/schema.sql`. GitHub renders the Mermaid diagram below. For the report, paste it into https://mermaid.live and export a PNG.

Solid lines are **real foreign keys**. They only exist inside one service's own tables. Dotted lines are **logical links across services**: they are not foreign keys, and the owning service checks them through the other service's API.

```mermaid
erDiagram
    %% ---------------- S1 Employee & Training (Kerolus) ----------------
    TEAMS ||--|{ EMPLOYEES : "has members"
    EMPLOYEES ||--o| TEAMS : "manages (teams.manager_id)"
    EMPLOYEES ||--o{ TRAININGS : "creates (created_by)"
    EMPLOYEES ||--o{ ASSIGNMENTS : "is assigned"
    EMPLOYEES ||--o{ ASSIGNMENTS : "assigns (assigned_by)"
    TRAININGS ||--o{ ASSIGNMENTS : "is assigned as"
    ASSIGNMENTS |o--o| ASSIGNMENTS : "renews (renewal_of_id)"

    %% ---------------- S2 Certificate & Compliance (Karim) ----------------
    CERTIFICATES ||--o{ COMPLIANCE_FLAGS : "raises"
    EMPLOYEES ||..o{ CERTIFICATES : "owns (via S1 API)"
    TRAININGS ||..o{ CERTIFICATES : "proves (via S1 API)"
    EMPLOYEES ||..o{ COMPLIANCE_FLAGS : "is flagged (via S1 API)"
    CERTIFICATES ||..o{ AUDIT_LOG : "audited"

    %% ---------------- S3 Dashboard & Reports (Yahia) ----------------
    EMPLOYEES ||..o{ COMPLIANCE_SNAPSHOTS : "daily status (via S1 API)"
    TEAMS ||..o{ REPORT_RUNS : "reported (via S1 API)"

    TEAMS {
        uuid id PK
        text name UK
        uuid manager_id FK
        timestamptz created_at
    }
    EMPLOYEES {
        uuid id PK
        text cognito_sub UK "Cognito sub claim"
        text name
        text email UK
        uuid team_id FK
        timestamptz created_at
    }
    TRAININGS {
        uuid id PK
        text name UK
        text category
        boolean requires_certificate
        int validity_months "NULL = never expires"
        uuid created_by FK
        timestamptz created_at
    }
    ASSIGNMENTS {
        uuid id PK
        uuid employee_id FK
        uuid training_id FK
        uuid assigned_by FK
        timestamptz assigned_at
        date due_date
        timestamptz completed_at "NULL = open"
        uuid renewal_of_id FK
    }
    CERTIFICATES {
        uuid id PK
        uuid employee_id "S1 id, no FK"
        uuid training_id "S1 id, no FK"
        text title
        text issuer
        text certificate_number
        date issue_date
        date expiry_date
        text review_status "Pending|Verified|Rejected"
        text s3_key UK "random key, private bucket"
        char file_hash "SHA-256"
        text mime_type
        int size_bytes "max 5 MB"
        timestamptz uploaded_at
        uuid verified_by
        timestamptz verified_at
        text reject_reason
        timestamptz deleted_at "soft delete"
    }
    COMPLIANCE_FLAGS {
        uuid id PK
        uuid certificate_id FK "NULL for Missing"
        uuid employee_id
        uuid training_id
        text flag_type "ExpiringSoon|Expired|Missing"
        timestamptz raised_at
        timestamptz notified_at
        timestamptz resolved_at
    }
    AUDIT_LOG {
        bigint id PK
        uuid actor_id
        text action
        uuid certificate_id
        timestamptz timestamp
        inet ip_address
        text result
    }
    COMPLIANCE_SNAPSHOTS {
        uuid id PK
        date snapshot_date
        uuid team_id
        uuid employee_id "UK with snapshot_date"
        text status
        text_array reasons
        int overdue_count
        int expiring_count
    }
    REPORT_RUNS {
        uuid id PK
        uuid team_id
        text category
        uuid generated_by
        timestamptz generated_at
        int row_count
    }
```

## Which service uses which entity, and how

| Entity | Owner | Create | Read / query | Update | Delete |
|---|---|---|---|---|---|
| teams | S1 | seed | S1: `GET /api/teams`, ownership checks; S2/S3 through S1's API | none | none |
| employees | S1 | seed + Cognito provisioning | S1: `/api/employees/me`, `/api/employees/{id}`, team members | `cognito_sub` set at provisioning | none |
| trainings | S1 | `POST /api/trainings` | `GET /api/trainings?category=`, `GET /api/trainings/{id}` | `PUT /api/trainings/{id}` (creator only) | none |
| assignments | S1 | `POST /api/assignments`, renewal on complete | `/api/assignments/me`, `/api/teams/{id}/assignments?status=` | `PATCH .../complete` sets `completed_at` | none (history) |
| certificates | S2 | `POST /api/certificates` | `/me`, `?teamId=&reviewStatus=`, `/{id}` | `PUT` while Pending, `PATCH verify` | soft delete (`deleted_at`) |
| compliance_flags | S2 | daily run-check | `GET /api/compliance/teams/{id}` | resolve / `notified_at` | none |
| audit_log | S2 | every upload, update, verify, reject, download, delete | investigation | **never** (append-only) | **never** |
| compliance_snapshots | S3 | nightly run-snapshot (upsert) | `/trend` | upsert on the same day | none |
| report_runs | S3 | every report | `/api/reports/history` | none | `DELETE /api/reports/history/{id}` |

**Key constraints**
- **One open assignment:** a partial unique index on `assignments(employee_id, training_id) WHERE completed_at IS NULL`.
- **Certificate dates:** a CHECK that `issue_date <= expiry_date`.
- **One open flag:** a unique index on `compliance_flags(employee_id, training_id, flag_type) WHERE resolved_at IS NULL`.
- **One snapshot per day:** `UNIQUE (employee_id, snapshot_date)` on `compliance_snapshots`.
