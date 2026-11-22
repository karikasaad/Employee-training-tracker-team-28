-- EN: Gives the three service roles a password so they can log in. The passwords are NOT in this file:
--     they come from environment variables DB_S1_PASSWORD, DB_S2_PASSWORD, DB_S3_PASSWORD (your local,
--     git-ignored .env; run it with: node infra/db/load.js roles). Needs psql 15+ for \getenv.
--     :'name' makes psql quote the value safely, so a password can never break out of the SQL.
-- Franco: Bey-ed-di el 3 roles password 3ashan ye2daro yedkhalo. El passwords mesh fel file da: betegi
--     men environment variables (el .env el local; shaghalo b node infra/db/load.js roles). :'name'
--     ya3ni psql bey-quote el value bel tare2a el aamna.
\set ON_ERROR_STOP on
\getenv s1_password DB_S1_PASSWORD
\getenv s2_password DB_S2_PASSWORD
\getenv s3_password DB_S3_PASSWORD
ALTER ROLE svc_s1 WITH LOGIN PASSWORD :'s1_password';
ALTER ROLE svc_s2 WITH LOGIN PASSWORD :'s2_password';
ALTER ROLE svc_s3 WITH LOGIN PASSWORD :'s3_password';
