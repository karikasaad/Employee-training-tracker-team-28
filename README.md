# Employee Training Tracker (Group 28)

A small web app where a company tracks mandatory employee training and certificates. Employees complete trainings and upload certificates; managers assign training, verify certificates and see who is compliant. Cloud Security coursework: the AWS design (Cognito, S3, RDS, Secrets Manager, CloudWatch, EventBridge) is simulated locally with Floci on Docker.

## Quick start (Windows PowerShell, Docker Desktop required)

```powershell
git clone <team repo url>
cd Employee-training-tracker-team-28
python scripts/dev.py up
python scripts/dev.py health
```

Full instructions and troubleshooting: [docs/DEV_SETUP.md](docs/DEV_SETUP.md).

## Folders

| Folder | What | Owner |
| --- | --- | --- |
| `services/employee-training` | Service 1: teams, employees, trainings, assignments (Node.js + Express) | Kerolus |
| `services/certificate-compliance` | Service 2: certificates, validity, flags, reminders (Node.js + Express) | Karim |
| `services/dashboard-reports` | Service 3: compliance dashboard and reports (Node.js + Express) | Yahia |
| `frontend` | plain HTML/CSS/JS served by nginx | everyone (own pages) |
| `infra` | nginx, Floci setup, IAM policies, scheduler | Karim |
| `docs` | setup, limitations, IAM, report | everyone |

`.env` is local only and never committed; see `.env.example`.
