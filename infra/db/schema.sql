-- EN: Database schema for the Employee Training Tracker (PostgreSQL 13+).
-- Franco: Schema el database bta3et el Employee Training Tracker (PostgreSQL 13 aw a7das).
-- EN: One database, but every table belongs to exactly ONE service. A service never reads another
--     service's tables; it calls that service's API instead.
-- Franco: Database wa7da, bas kol table bta3 service wa7da bas. Mafeesh service te2ra gedwal service
--     tanya; betnadi el API bta3ha.
-- EN: Safe to run twice (IF NOT EXISTS everywhere).
-- Franco: Momken teshaghalo marteen men gheir moshkela.

-- EN: UUID primary keys: ids cannot be guessed by counting (1, 2, 3...), which makes IDOR attacks harder.
--     Ownership checks in the code are still the real protection.
-- Franco: El ids UUID 3ashan mayetkhammenoosh (1, 2, 3...). Bas el ownership check fel code howa el
--     7emaya el 7a2i2eya.

-- =====================================================================================================
-- S1 Employee & Training (owner: Kerolus): teams, employees, trainings, assignments
-- =====================================================================================================

CREATE TABLE IF NOT EXISTS teams (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name        text NOT NULL UNIQUE CHECK (length(name) BETWEEN 1 AND 100),
    -- EN: every team has exactly one manager; FK added below because employees references teams too.
    -- Franco: kol team leh manager wa7ed; el FK beyetzaad ta7t 3ashan employees bet-reference teams.
    manager_id  uuid,
    created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS employees (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    -- EN: the Cognito user id ("sub" claim). Filled by infra/floci/cognito after the users are created.
    -- Franco: id el user fe Cognito (claim "sub"). Beyetmeli men infra/floci/cognito ba3d ma el users
    --     yet3amalo.
    cognito_sub text UNIQUE,
    name        text NOT NULL CHECK (length(name) BETWEEN 1 AND 100),
    email       text NOT NULL UNIQUE CHECK (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
    team_id     uuid NOT NULL REFERENCES teams(id),
    created_at  timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'teams_manager_fk') THEN
        -- EN: DEFERRABLE lets the seed insert a team and its manager in the same transaction.
        -- Franco: DEFERRABLE 3ashan el seed ye7ott el team w el manager bta3o fe nafs el transaction.
        ALTER TABLE teams ADD CONSTRAINT teams_manager_fk
            FOREIGN KEY (manager_id) REFERENCES employees(id) DEFERRABLE INITIALLY DEFERRED;
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS trainings (
    id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name                 text NOT NULL UNIQUE CHECK (length(name) BETWEEN 1 AND 150),
    category             text NOT NULL CHECK (length(category) BETWEEN 1 AND 50),
    requires_certificate boolean NOT NULL DEFAULT false,
    -- EN: NULL = never expires. A value means "repeat every N months" (renewal rule).
    -- Franco: NULL = malhash sala7eya. Law feeh rakam ya3ni "yet3ad kol N shahr" (rule el renewal).
    validity_months      integer CHECK (validity_months BETWEEN 1 AND 120),
    created_by           uuid NOT NULL REFERENCES employees(id),
    created_at           timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS assignments (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id   uuid NOT NULL REFERENCES employees(id),
    training_id   uuid NOT NULL REFERENCES trainings(id),
    assigned_by   uuid NOT NULL REFERENCES employees(id),
    assigned_at   timestamptz NOT NULL DEFAULT now(),
    due_date      date NOT NULL,
    completed_at  timestamptz,
    -- EN: points to the assignment this one renews (renewal chain).
    -- Franco: beyshawer 3ala el assignment elly da beyeggaddedo (silsilet el renewal).
    renewal_of_id uuid REFERENCES assignments(id)
    -- EN: NO status column on purpose: Assigned / Completed / Overdue is CALCULATED on read
    --     (business rule), so it can never be out of date.
    -- Franco: Mafeesh column status 3ala gheer: Assigned / Completed / Overdue bet-et7seb wa2t el
    --     qeraya, 3ashan ma tebqash 2adima abadan.
);

-- EN: Business rule in the database itself: at most ONE open (not completed) assignment of the same
--     training per employee. A second one fails, and the API turns that into 409 Conflict.
-- Franco: Rule fel database nafsaha: assignment wa7ed bas maftoo7 le nafs el training le nafs el
--     mowazzaf. El tani beyfshal, w el API beyerga3 409.
CREATE UNIQUE INDEX IF NOT EXISTS assignments_one_open_per_training
    ON assignments (employee_id, training_id) WHERE completed_at IS NULL;
CREATE INDEX IF NOT EXISTS assignments_employee_idx ON assignments (employee_id);
CREATE INDEX IF NOT EXISTS assignments_due_idx ON assignments (due_date) WHERE completed_at IS NULL;
CREATE INDEX IF NOT EXISTS employees_team_idx ON employees (team_id);
CREATE INDEX IF NOT EXISTS trainings_category_idx ON trainings (category);

-- =====================================================================================================
-- S2 Certificate & Compliance (owner: Karim): certificates, compliance_flags, audit_log
-- EN: employee_id / training_id here are NOT foreign keys: they belong to S1's tables, and S2 checks
--     them through S1's API. Foreign keys only exist inside one service's own tables.
-- Franco: employee_id / training_id hena mesh FK: dol bta3een gedawel S1, w S2 bet-check-hom 3an
--     taree2 el API bta3 S1. El FK gowwa gedawel el service nafsaha bas.
-- =====================================================================================================

CREATE TABLE IF NOT EXISTS certificates (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id        uuid NOT NULL,
    training_id        uuid NOT NULL,
    title              text NOT NULL CHECK (length(title) BETWEEN 1 AND 150),
    issuer             text NOT NULL CHECK (length(issuer) BETWEEN 1 AND 150),
    certificate_number text CHECK (length(certificate_number) <= 100),
    issue_date         date NOT NULL,
    expiry_date        date NOT NULL,
    review_status      text NOT NULL DEFAULT 'Pending'
                       CHECK (review_status IN ('Pending', 'Verified', 'Rejected')),
    -- EN: random object key in the private bucket, never the user's file name (no path traversal).
    -- Franco: esm 3ashwa2i fel bucket el private, mesh esm el file bta3 el user (mafeesh path traversal).
    s3_key             text NOT NULL UNIQUE,
    file_hash          char(64) NOT NULL CHECK (file_hash ~ '^[0-9a-f]{64}$'),
    mime_type          text NOT NULL CHECK (mime_type IN ('application/pdf', 'image/jpeg', 'image/png')),
    size_bytes         integer NOT NULL CHECK (size_bytes BETWEEN 1 AND 5242880),
    uploaded_at        timestamptz NOT NULL DEFAULT now(),
    verified_by        uuid,
    verified_at        timestamptz,
    reject_reason      text CHECK (length(reject_reason) <= 500),
    deleted_at         timestamptz,
    -- EN: a certificate cannot be issued after it expires.
    -- Franco: el certificate mayenfa3sh yeb2a issued ba3d ma yentehy.
    CONSTRAINT certificates_dates_ck CHECK (issue_date <= expiry_date)
);
CREATE INDEX IF NOT EXISTS certificates_employee_idx ON certificates (employee_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS certificates_review_idx ON certificates (review_status) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS compliance_flags (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    -- EN: NULL for a Missing flag (there is no certificate to point to).
    -- Franco: NULL fe flag Missing (mafeesh certificate neshawer 3aleih).
    certificate_id uuid REFERENCES certificates(id),
    employee_id    uuid NOT NULL,
    -- EN: added to the proposal's columns: a Missing flag must say WHICH training has no certificate.
    -- Franco: zawednaha 3ala el proposal: flag Missing lazem ye2ool anhi training malhash certificate.
    training_id    uuid NOT NULL,
    flag_type      text NOT NULL CHECK (flag_type IN ('ExpiringSoon', 'Expired', 'Missing')),
    raised_at      timestamptz NOT NULL DEFAULT now(),
    notified_at    timestamptz,
    resolved_at    timestamptz
);
-- EN: only one OPEN flag of a type per employee + training, so the daily job cannot create duplicates.
-- Franco: flag wa7ed bas maftoo7 men kol noo3 lel mowazzaf + el training, 3ashan el job el yomi
--     mayekarrarsh.
CREATE UNIQUE INDEX IF NOT EXISTS compliance_flags_one_open
    ON compliance_flags (employee_id, training_id, flag_type) WHERE resolved_at IS NULL;

CREATE TABLE IF NOT EXISTS audit_log (
    id             bigserial PRIMARY KEY,
    actor_id       uuid NOT NULL,
    action         text NOT NULL CHECK (action IN ('upload', 'update', 'verify', 'reject', 'download', 'delete')),
    certificate_id uuid,
    "timestamp"    timestamptz NOT NULL DEFAULT now(),
    ip_address     inet,
    result         text NOT NULL CHECK (result IN ('success', 'denied', 'error'))
);
CREATE INDEX IF NOT EXISTS audit_log_certificate_idx ON audit_log (certificate_id);

-- =====================================================================================================
-- S3 Manager Dashboard & Reports (owner: Yahia): compliance_snapshots, report_runs
-- =====================================================================================================

CREATE TABLE IF NOT EXISTS compliance_snapshots (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    snapshot_date  date NOT NULL,
    team_id        uuid NOT NULL,
    employee_id    uuid NOT NULL,
    status         text NOT NULL CHECK (status IN ('Compliant', 'Non-compliant')),
    reasons        text[] NOT NULL DEFAULT '{}',
    overdue_count  integer NOT NULL DEFAULT 0 CHECK (overdue_count >= 0),
    expiring_count integer NOT NULL DEFAULT 0 CHECK (expiring_count >= 0),
    -- EN: one row per employee per day: running the nightly snapshot twice cannot duplicate rows.
    -- Franco: satr wa7ed lel mowazzaf fel yom: law el snapshot eshtaghal marteen mafeesh takraar.
    CONSTRAINT compliance_snapshots_one_per_day UNIQUE (employee_id, snapshot_date)
);
CREATE INDEX IF NOT EXISTS compliance_snapshots_team_date_idx ON compliance_snapshots (team_id, snapshot_date);

CREATE TABLE IF NOT EXISTS report_runs (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    team_id      uuid NOT NULL,
    category     text CHECK (length(category) <= 50),
    generated_by uuid NOT NULL,
    generated_at timestamptz NOT NULL DEFAULT now(),
    row_count    integer NOT NULL CHECK (row_count >= 0)
);

-- =====================================================================================================
-- Least privilege: one database role per service
-- EN: each service connects with its own role that can only touch its own tables. If one service is
--     compromised, it still cannot read or change the other services' data. The roles are created
--     here WITHOUT a password (NOLOGIN); infra/db/roles.sql gives them a password from the environment.
-- Franco: kol service betdkhol b role khas beha yeqdar yelmes gedwalha bas. Law service etakhtaret,
--     mateqdarsh te2ra aw teghayyar data el services el tanya. El roles beyet3amalo hena men gheir
--     password; infra/db/roles.sql bey-ed-dilhom password men el environment.
-- =====================================================================================================

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'svc_s1') THEN CREATE ROLE svc_s1 NOLOGIN; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'svc_s2') THEN CREATE ROLE svc_s2 NOLOGIN; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'svc_s3') THEN CREATE ROLE svc_s3 NOLOGIN; END IF;
END $$;

-- EN: nobody gets anything by default; then each role gets only what its service needs.
-- Franco: mafeesh 7ad leh 7aga by default; ba3den kol role yakhod elly el service bta3to me7tagah bas.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO svc_s1, svc_s2, svc_s3;

-- EN: S1 never deletes (assignments are history); it only reads, creates and updates.
-- Franco: S1 mabtemsa7sh (el assignments tareekh); bte2ra w tes-ne3 w te3addel bas.
GRANT SELECT, INSERT, UPDATE ON teams, employees, trainings, assignments TO svc_s1;

-- EN: S2 soft-deletes certificates (deleted_at), so it needs no DELETE. The audit log is append-only:
--     INSERT and SELECT, never UPDATE or DELETE, so nobody can rewrite history.
-- Franco: S2 bet-soft-delete (deleted_at) f mesh me7taga DELETE. El audit log append-only: INSERT w
--     SELECT bas, mafeesh UPDATE wala DELETE, 3ashan ma7addesh yeghayyar el tareekh.
GRANT SELECT, INSERT, UPDATE ON certificates, compliance_flags TO svc_s2;
GRANT SELECT, INSERT ON audit_log TO svc_s2;
GRANT USAGE ON SEQUENCE audit_log_id_seq TO svc_s2;

-- EN: S3 upserts snapshots and may delete its own report history (DELETE /api/reports/history/{id}).
-- Franco: S3 bet-upsert el snapshots w momken temsa7 tareekh el reports bta3ha.
GRANT SELECT, INSERT, UPDATE ON compliance_snapshots TO svc_s3;
GRANT SELECT, INSERT, DELETE ON report_runs TO svc_s3;
