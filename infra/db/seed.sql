-- EN: Test data for development and the demo. It WIPES all tables first, so never run it on real data.
--     Dates are relative to CURRENT_DATE, so "overdue", "due today" and "expiring soon" stay true on any
--     day we run it. Fixed UUIDs make the ids easy to recognise in tests and in the API contract.
-- Franco: Data tagrebeya lel development w el demo. Bet-masa7 kol el gedawel el awel, f matshaghalhash
--     3ala data 7a2i2eya abadan. El tawareekh mansooba le CURRENT_DATE, f "overdue" w "due today" w
--     "expiring soon" yefdalo sa7 ay yom. El UUIDs sabta 3ashan nemayezha fel tests w el contract.
-- EN: Cognito users are created afterwards by infra/floci/cognito (same e-mails); it writes each user's
--     "sub" into employees.cognito_sub.
-- Franco: Users Cognito beyet3amalo ba3daha men infra/floci/cognito (nafs el e-mails); w beyekteb el
--     "sub" bta3 kol user fe employees.cognito_sub.
\set ON_ERROR_STOP on
BEGIN;

TRUNCATE report_runs, compliance_snapshots, audit_log, compliance_flags, certificates,
         assignments, trainings, employees, teams CASCADE;

-- ---------------------------------------------------------------- teams + employees (S1)
-- EN: team.manager_id is checked at COMMIT (deferred FK), so the team can be inserted before its manager.
-- Franco: team.manager_id bet-et-check wa2t el COMMIT, f n2dar ne7ott el team abl el manager.
INSERT INTO teams (id, name, manager_id) VALUES
 ('10000000-0000-4000-8000-000000000001', 'Operations', '20000000-0000-4000-8000-000000000001'),
 ('10000000-0000-4000-8000-000000000002', 'Laboratory', '20000000-0000-4000-8000-000000000005');

INSERT INTO employees (id, name, email, team_id) VALUES
 -- Operations
 ('20000000-0000-4000-8000-000000000001', 'Mona Hassan',   'mona.manager@example.com', '10000000-0000-4000-8000-000000000001'),
 ('20000000-0000-4000-8000-000000000002', 'Ahmed Ali',     'ahmed@example.com',        '10000000-0000-4000-8000-000000000001'),
 ('20000000-0000-4000-8000-000000000003', 'Sara Mahmoud',  'sara@example.com',         '10000000-0000-4000-8000-000000000001'),
 ('20000000-0000-4000-8000-000000000004', 'Youssef Adel',  'youssef@example.com',      '10000000-0000-4000-8000-000000000001'),
 -- Laboratory
 ('20000000-0000-4000-8000-000000000005', 'Omar Fathy',    'omar.manager@example.com', '10000000-0000-4000-8000-000000000002'),
 ('20000000-0000-4000-8000-000000000006', 'Nour Ibrahim',  'nour@example.com',         '10000000-0000-4000-8000-000000000002'),
 ('20000000-0000-4000-8000-000000000007', 'Hana Mostafa',  'hana@example.com',         '10000000-0000-4000-8000-000000000002'),
 ('20000000-0000-4000-8000-000000000008', 'Tarek Samir',   'tarek@example.com',        '10000000-0000-4000-8000-000000000002');

-- ---------------------------------------------------------------- trainings (S1)
-- EN: a mix of: certificate required or not, and "expires every N months" or never.
-- Franco: khaleet: certificate matloob aw la, w "betentehy kol N shahr" aw la2.
INSERT INTO trainings (id, name, category, requires_certificate, validity_months, created_by) VALUES
 ('30000000-0000-4000-8000-000000000001', 'Fire Safety',                    'Safety',     true,  12,   '20000000-0000-4000-8000-000000000001'),
 ('30000000-0000-4000-8000-000000000002', 'First Aid',                      'Safety',     true,  24,   '20000000-0000-4000-8000-000000000001'),
 ('30000000-0000-4000-8000-000000000003', 'Data Protection Basics',         'Compliance', false, 12,   '20000000-0000-4000-8000-000000000005'),
 ('30000000-0000-4000-8000-000000000004', 'Code of Conduct',                'Compliance', false, NULL, '20000000-0000-4000-8000-000000000001'),
 ('30000000-0000-4000-8000-000000000005', 'Forklift Operation',             'Operations', true,  36,   '20000000-0000-4000-8000-000000000001'),
 ('30000000-0000-4000-8000-000000000006', 'Chemical Handling',              'Laboratory', true,  12,   '20000000-0000-4000-8000-000000000005'),
 ('30000000-0000-4000-8000-000000000007', 'Information Security Awareness', 'Security',   false, 12,   '20000000-0000-4000-8000-000000000005'),
 ('30000000-0000-4000-8000-000000000008', 'Manual Handling',                'Safety',     false, NULL, '20000000-0000-4000-8000-000000000001');

-- ---------------------------------------------------------------- assignments (S1), every state
-- EN: helper: a completed_at timestamp N days ago at 09:00 UTC.
-- Franco: helper: completed_at men N ayyam el sa3a 9 el sob7 UTC.
CREATE TEMP TABLE d AS SELECT CURRENT_DATE AS today;

INSERT INTO assignments (id, employee_id, training_id, assigned_by, assigned_at, due_date, completed_at, renewal_of_id)
SELECT id::uuid, emp::uuid, trn::uuid, mgr::uuid, (today - assigned_ago) + time '08:00',
       today + due_in, CASE WHEN done_ago IS NULL THEN NULL ELSE ((today - done_ago) + time '09:00') AT TIME ZONE 'UTC' END,
       NULL
FROM d, (VALUES
 -- EN: id, employee, training, assigned by, assigned N days ago, due in N days (negative = past), completed N days ago
 -- Ahmed: OVERDUE (due 10 days ago, not done) + DUE TODAY (not overdue, rule: due today is Assigned)
 ('40000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 40, -10, NULL::int),
 ('40000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000004', '20000000-0000-4000-8000-000000000001', 14,   0, NULL),
 -- Sara: COMPLETED on time (renewal below) + FUTURE
 ('40000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-000000000003', '30000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 90, -60,   65),
 ('40000000-0000-4000-8000-000000000005', '20000000-0000-4000-8000-000000000003', '30000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-000000000001',  5,  20, NULL),
 -- Youssef: COMPLETED LATE (still Completed) + First Aid completed with NO certificate (S2 -> Missing)
 ('40000000-0000-4000-8000-000000000006', '20000000-0000-4000-8000-000000000004', '30000000-0000-4000-8000-000000000005', '20000000-0000-4000-8000-000000000001', 60, -30,   20),
 ('40000000-0000-4000-8000-000000000008', '20000000-0000-4000-8000-000000000004', '30000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000001',130, -95,  100),
 -- Nour: completed 400 days ago, certificate EXPIRED; its renewal is now overdue too
 ('40000000-0000-4000-8000-000000000010', '20000000-0000-4000-8000-000000000006', '30000000-0000-4000-8000-000000000006', '20000000-0000-4000-8000-000000000005',430,-405,  400),
 -- Hana: FUTURE + completed recently (renewal below)
 ('40000000-0000-4000-8000-000000000012', '20000000-0000-4000-8000-000000000007', '30000000-0000-4000-8000-000000000006', '20000000-0000-4000-8000-000000000005',  3,   5, NULL),
 ('40000000-0000-4000-8000-000000000013', '20000000-0000-4000-8000-000000000007', '30000000-0000-4000-8000-000000000007', '20000000-0000-4000-8000-000000000005', 20,   2,    3),
 -- Tarek: OVERDUE by one day (yesterday) + First Aid completed, certificate only Pending / Rejected
 ('40000000-0000-4000-8000-000000000015', '20000000-0000-4000-8000-000000000008', '30000000-0000-4000-8000-000000000008', '20000000-0000-4000-8000-000000000005', 30,  -1, NULL),
 ('40000000-0000-4000-8000-000000000016', '20000000-0000-4000-8000-000000000008', '30000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000005', 30,  -5,   10)
) AS v(id, emp, trn, mgr, assigned_ago, due_in, done_ago);

-- EN: renewal rule: each completed training with validity_months gets its next assignment,
--     due completed_at + validity_months, linked with renewal_of_id.
-- Franco: rule el renewal: kol training khelset w leha validity_months biyetfete7laha assignment
--     gedeed, ma3ado completed_at + validity_months, w marboot b renewal_of_id.
INSERT INTO assignments (id, employee_id, training_id, assigned_by, assigned_at, due_date, renewal_of_id)
SELECT ('41' || substr(a.id::text, 3))::uuid, a.employee_id, a.training_id, a.assigned_by, a.completed_at,
       (a.completed_at::date + make_interval(months => t.validity_months))::date, a.id
FROM assignments a JOIN trainings t ON t.id = a.training_id
WHERE a.completed_at IS NOT NULL AND t.validity_months IS NOT NULL;

-- ---------------------------------------------------------------- certificates (S2)
-- EN: seed rows only: the s3_key points to no real file, so "download" works only for files uploaded
--     through the app.
-- Franco: rows tagrebeya bas: el s3_key mesh beyshawer 3ala file 7a2i2i, f el download beyeshtaghal
--     bas lel files elly etrafa3et men el app.
INSERT INTO certificates (id, employee_id, training_id, title, issuer, certificate_number, issue_date, expiry_date,
                          review_status, s3_key, file_hash, mime_type, size_bytes, uploaded_at,
                          verified_by, verified_at, reject_reason)
SELECT id::uuid, emp::uuid, trn::uuid, title, 'Seed Training Institute', num, today + issued, today + expires,
       status, 'seed/' || id || '.pdf', encode(sha256(convert_to(id, 'UTF8')), 'hex'), 'application/pdf', 120000,
       (today + issued) + time '10:00',
       CASE WHEN status = 'Pending' THEN NULL ELSE verifier::uuid END,
       CASE WHEN status = 'Pending' THEN NULL ELSE ((today + issued + 1) + time '11:00') AT TIME ZONE 'UTC' END,
       CASE WHEN status = 'Rejected' THEN 'The scan is unreadable; please upload a clearer copy.' END
FROM d, (VALUES
 -- Sara Fire Safety: Verified, VALID (expires in 300 days)
 ('50000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000003', '30000000-0000-4000-8000-000000000001', 'Fire Safety Certificate',   'FS-1001', -65,  300, 'Verified', '20000000-0000-4000-8000-000000000001'),
 -- Youssef Forklift: Verified, EXPIRING SOON (10 days)
 ('50000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000004', '30000000-0000-4000-8000-000000000005', 'Forklift Licence',          'FL-2002', -1085, 10, 'Verified', '20000000-0000-4000-8000-000000000001'),
 -- Nour Chemical Handling: Verified but EXPIRED (35 days ago)
 ('50000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-000000000006', '30000000-0000-4000-8000-000000000006', 'Chemical Handling Card',    'CH-3003', -400, -35, 'Verified', '20000000-0000-4000-8000-000000000005'),
 -- Tarek First Aid: one Pending (waiting for the manager) and an older Rejected one
 ('50000000-0000-4000-8000-000000000004', '20000000-0000-4000-8000-000000000008', '30000000-0000-4000-8000-000000000002', 'First Aid Certificate',     'FA-4004', -10,  720, 'Pending',  NULL),
 ('50000000-0000-4000-8000-000000000005', '20000000-0000-4000-8000-000000000008', '30000000-0000-4000-8000-000000000002', 'First Aid Certificate',     'FA-4003', -12,  718, 'Rejected', '20000000-0000-4000-8000-000000000005')
) AS v(id, emp, trn, title, num, issued, expires, status, verifier);

COMMIT;

-- ---------------------------------------------------------------- print the test users
-- EN: the Cognito group follows the data: the manager of a team is in "Manager", everyone else in
--     "Employee". Passwords are NOT here: they are set by infra/floci/cognito from your .env.
-- Franco: el group fe Cognito mashi ma3 el data: manager el team fe "Manager", w el ba2y fe "Employee".
--     El passwords mesh hena: beyet7atto men infra/floci/cognito men el .env bta3ak.
\echo
\echo 'Seeded test users (log in with the e-mail; password = TEST_USER_PASSWORD from your .env):'
SELECT e.email,
       e.name,
       t.name AS team,
       CASE WHEN t.manager_id = e.id THEN 'Manager' ELSE 'Employee' END AS cognito_group
FROM employees e JOIN teams t ON t.id = e.team_id
ORDER BY t.name DESC, cognito_group DESC, e.name;

\echo 'Row counts:'
SELECT 'teams' AS table_name, count(*) FROM teams
UNION ALL SELECT 'employees', count(*) FROM employees
UNION ALL SELECT 'trainings', count(*) FROM trainings
UNION ALL SELECT 'assignments', count(*) FROM assignments
UNION ALL SELECT 'certificates', count(*) FROM certificates;
