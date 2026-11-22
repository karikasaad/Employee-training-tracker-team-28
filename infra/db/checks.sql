-- EN: Database tests. Run AFTER schema.sql and seed.sql. Every block expects a rule to hold; if it does
--     not, the script stops with "FAIL: ...". All changes are rolled back at the end.
-- Franco: Tests el database. Shaghalha BA3D schema.sql w seed.sql. Kol block beyetwaqa3 en rule
--     shaghala; law la2 el script beyo2af w yekteb "FAIL: ...". Kol el taghyeerat betetlaghy fel akher.
\set ON_ERROR_STOP on
BEGIN;

-- EN: T-DB1: a second OPEN assignment of the same training for the same employee is rejected (-> 409).
-- Franco: T-DB1: assignment tani maftoo7 le nafs el training le nafs el mowazzaf beyetrefed (-> 409).
DO $$
BEGIN
    BEGIN
        INSERT INTO assignments (employee_id, training_id, assigned_by, due_date)
        VALUES ('20000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000001',
                '20000000-0000-4000-8000-000000000001', CURRENT_DATE + 30);
        RAISE EXCEPTION 'FAIL: duplicate open assignment was accepted';
    EXCEPTION WHEN unique_violation THEN
        RAISE NOTICE 'PASS T-DB1: duplicate open assignment rejected (unique_violation)';
    END;
END $$;

-- EN: T-DB2: once the first one is completed, a new one for the same training IS allowed (renewal).
-- Franco: T-DB2: lama el awel yekhlas, assignment gedeed le nafs el training masmoo7 (renewal).
DO $$
DECLARE n int;
BEGIN
    SELECT count(*) INTO n FROM assignments
    WHERE employee_id = '20000000-0000-4000-8000-000000000003'
      AND training_id = '30000000-0000-4000-8000-000000000001';
    IF n <> 2 THEN RAISE EXCEPTION 'FAIL: expected completed + renewal (2 rows), got %', n; END IF;
    RAISE NOTICE 'PASS T-DB2: completed assignment and its open renewal coexist';
END $$;

-- EN: T-DB3: issue_date after expiry_date is rejected.
-- Franco: T-DB3: issue_date ba3d expiry_date beyetrefed.
DO $$
BEGIN
    BEGIN
        INSERT INTO certificates (employee_id, training_id, title, issuer, issue_date, expiry_date,
                                  s3_key, file_hash, mime_type, size_bytes)
        VALUES ('20000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000001', 't', 'i',
                CURRENT_DATE, CURRENT_DATE - 1, 'test/x', repeat('a', 64), 'application/pdf', 10);
        RAISE EXCEPTION 'FAIL: issue_date > expiry_date was accepted';
    EXCEPTION WHEN check_violation THEN
        RAISE NOTICE 'PASS T-DB3: issue_date after expiry_date rejected (check_violation)';
    END;
END $$;

-- EN: T-DB4: a file bigger than 5 MB or of a type outside the allow-list cannot be stored.
-- Franco: T-DB4: file akbar men 5 MB aw noo3 barra el allow-list mayet-khazzansh.
DO $$
BEGIN
    BEGIN
        INSERT INTO certificates (employee_id, training_id, title, issuer, issue_date, expiry_date,
                                  s3_key, file_hash, mime_type, size_bytes)
        VALUES ('20000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000001', 't', 'i',
                CURRENT_DATE, CURRENT_DATE + 1, 'test/y', repeat('a', 64), 'text/html', 10);
        RAISE EXCEPTION 'FAIL: text/html certificate was accepted';
    EXCEPTION WHEN check_violation THEN
        RAISE NOTICE 'PASS T-DB4: mime type outside the allow-list rejected';
    END;
END $$;

-- EN: T-DB5: running the snapshot twice on one day cannot create two rows for the same employee.
-- Franco: T-DB5: el snapshot marteen fel yom mayenfa3sh ye3mel satreen lel mowazzaf.
DO $$
BEGIN
    INSERT INTO compliance_snapshots (snapshot_date, team_id, employee_id, status)
    VALUES (CURRENT_DATE, '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000002', 'Compliant');
    BEGIN
        INSERT INTO compliance_snapshots (snapshot_date, team_id, employee_id, status)
        VALUES (CURRENT_DATE, '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000002', 'Non-compliant');
        RAISE EXCEPTION 'FAIL: two snapshots for one employee on one day';
    EXCEPTION WHEN unique_violation THEN
        RAISE NOTICE 'PASS T-DB5: one snapshot per employee per day';
    END;
END $$;

-- EN: T-DB6..9: least privilege. Each service role can reach only its own tables.
-- Franco: T-DB6..9: least privilege. Kol role yewsal le gedawel el service bta3to bas.
SET LOCAL ROLE svc_s1;
DO $$
BEGIN
    PERFORM count(*) FROM assignments;
    BEGIN
        PERFORM count(*) FROM certificates;
        RAISE EXCEPTION 'FAIL: svc_s1 can read certificates';
    EXCEPTION WHEN insufficient_privilege THEN
        RAISE NOTICE 'PASS T-DB6: svc_s1 reads assignments but is denied certificates';
    END;
    BEGIN
        DELETE FROM assignments WHERE false;
        RAISE EXCEPTION 'FAIL: svc_s1 can delete assignments';
    EXCEPTION WHEN insufficient_privilege THEN
        RAISE NOTICE 'PASS T-DB7: svc_s1 cannot delete assignment history';
    END;
END $$;
RESET ROLE;

SET LOCAL ROLE svc_s2;
DO $$
BEGIN
    BEGIN
        UPDATE audit_log SET result = 'success' WHERE false;
        RAISE EXCEPTION 'FAIL: svc_s2 can update the audit log';
    EXCEPTION WHEN insufficient_privilege THEN
        RAISE NOTICE 'PASS T-DB8: audit_log is append-only for svc_s2 (UPDATE denied)';
    END;
    BEGIN
        PERFORM count(*) FROM employees;
        RAISE EXCEPTION 'FAIL: svc_s2 can read employees';
    EXCEPTION WHEN insufficient_privilege THEN
        RAISE NOTICE 'PASS T-DB9: svc_s2 is denied S1 tables';
    END;
END $$;
RESET ROLE;

SET LOCAL ROLE svc_s3;
DO $$
BEGIN
    PERFORM count(*) FROM compliance_snapshots;
    BEGIN
        PERFORM count(*) FROM assignments;
        RAISE EXCEPTION 'FAIL: svc_s3 can read assignments';
    EXCEPTION WHEN insufficient_privilege THEN
        RAISE NOTICE 'PASS T-DB10: svc_s3 reads its snapshots but is denied S1 tables';
    END;
END $$;
RESET ROLE;

-- EN: T-DB11: the seed covers every state the demo and the tests need.
-- Franco: T-DB11: el seed feeh kol el 7alat elly el demo w el tests me7tagenha.
DO $$
DECLARE overdue int; due_today int; future int; completed_late int; expiring int; expired int;
BEGIN
    SELECT count(*) INTO overdue   FROM assignments WHERE completed_at IS NULL AND due_date < CURRENT_DATE;
    SELECT count(*) INTO due_today FROM assignments WHERE completed_at IS NULL AND due_date = CURRENT_DATE;
    SELECT count(*) INTO future    FROM assignments WHERE completed_at IS NULL AND due_date > CURRENT_DATE;
    SELECT count(*) INTO completed_late FROM assignments WHERE completed_at::date > due_date;
    SELECT count(*) INTO expiring  FROM certificates WHERE review_status = 'Verified'
                                    AND expiry_date BETWEEN CURRENT_DATE AND CURRENT_DATE + 30;
    SELECT count(*) INTO expired   FROM certificates WHERE review_status = 'Verified' AND expiry_date < CURRENT_DATE;
    IF overdue = 0 OR due_today = 0 OR future = 0 OR completed_late = 0 OR expiring = 0 OR expired = 0 THEN
        RAISE EXCEPTION 'FAIL: seed misses a state (overdue %, due today %, future %, completed late %, expiring %, expired %)',
            overdue, due_today, future, completed_late, expiring, expired;
    END IF;
    RAISE NOTICE 'PASS T-DB11: seed has overdue %, due today %, future %, completed late %, expiring soon %, expired %',
        overdue, due_today, future, completed_late, expiring, expired;
END $$;

ROLLBACK;
\echo 'All database checks passed.'
