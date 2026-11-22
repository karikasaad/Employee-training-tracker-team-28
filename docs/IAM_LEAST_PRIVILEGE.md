# IAM least privilege

Each service gets its own role and policy (`infra/iam/*.json`, created in Floci by `infra/floci/init.py`). A role may do only what its service needs, on only the resources it needs. If one service is compromised, the attacker gets that service's small set of permissions, not the whole cloud account.

| Role | Allowed | Why | Explicitly not allowed |
| --- | --- | --- | --- |
| `ett-s1-role` (Employee & Training) | read secret `ett/db`; write logs to `/ett/s1` | S1 only needs the database login and its own logs | any S3 access, SendGrid key, service-client secret, other log groups |
| `ett-s2-role` (Certificate & Compliance) | `s3:PutObject` and `s3:GetObject` on `certificates/*`; use the certificate KMS key; read `ett/db`, `ett/sendgrid`, `ett/service-client`; write logs to `/ett/s2` | S2 stores and serves certificate files, sends e-mail, and calls other services for the daily job | listing or deleting the bucket, changing bucket policy, other services' logs |
| `ett-s3-role` (Dashboard & Reports) | read `ett/db`, `ett/service-client`; write logs to `/ett/s3` | S3 reads its own tables and calls S1/S2 for the nightly snapshot | any S3 access, SendGrid key, other log groups |

Why not one admin role for everything: broad access means a single bug (for example in the upload code) could read every secret and every certificate. Separate roles also make the access easy to explain and test.

The trust policy lets the compute service (EC2 instances of the Elastic Beanstalk environments in the AWS design) assume the role, so no long-lived access keys are stored in the code.

## Honest limitation

Floci does **not** enforce IAM policies by default: any call with any credentials succeeds. The policies and roles here are created and reviewed, and they are exactly what we would deploy to real AWS, but the simulation cannot prove that a forbidden call is refused. Section "Limitations" of the report says this too (see `docs/LIMITATIONS.md`).
