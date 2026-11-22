# Limitations of the Floci simulation

AWS is simulated locally with Floci on Docker. Everything here is written from what we know so far; rows marked "to confirm" are filled with real results after `python scripts/dev.py spike` (see `docs/FLOCI_SPIKE.md`). **Everyone may append rows; keep each row short, with a reason and a proposed improvement.**

| Area | What differs from real AWS | Reason | Proposed improvement on real AWS |
| --- | --- | --- | --- |
| IAM | Floci does not enforce IAM policies by default: forbidden calls are not refused | emulator limitation | deploy the same policies from `infra/iam/` to real IAM; test with the IAM policy simulator |
| Database | A plain Postgres container stands in for RDS | simpler, same SQL | RDS in private subnets, Multi-AZ, automated backups, encryption at rest |
| Storage | Floci runs with `FLOCI_STORAGE_MODE=memory`: data is lost when it restarts | keeps local runs clean | run `python scripts/dev.py init` again (idempotent); persistent mode if needed |
| Daily jobs | EventBridge schedule -> HTTP call may not be supported (to confirm); a fallback cron container (`infra/scheduler`) calls the jobs with a service token | scheduled HTTP targets are not verified in the emulator | EventBridge scheduled rule + API destination with OAuth client credentials (what `init.py` tries to create), CloudWatch alarm on failed invocations |
| Cognito | MFA, groups claim and token lifetime behaviour: to confirm in the Cognito spike | emulator coverage unknown | real Cognito user pool with MFA required for managers, 15-minute access tokens |
| CloudWatch | Alarms may be created but not fire (to confirm) | emulator coverage unknown | real alarms with SNS notification |
| TLS | Self-signed certificate on nginx | local only | ACM certificate on CloudFront / load balancer |
| Secrets | The SendGrid secret holds a placeholder locally, so e-mails are skipped | the real key must never be committed | add the real key by hand to Secrets Manager |
