# Local setup (Windows, PowerShell)

Everything runs in Docker. You only need Docker Desktop and Python 3 (for the helper script). No bash, no make.

## Start in 5 commands

```powershell
git clone <team repo url>
cd Employee-training-tracker-team-28
python scripts/dev.py up
python scripts/dev.py health
python scripts/dev.py status
```

`up` creates `.env` (dummy values) and a self-signed HTTPS certificate for you, then builds and starts Floci, Postgres, the three services and nginx. `health` must print `OK` three times.

| What | Where |
| --- | --- |
| Website (nginx, HTTPS) | https://localhost:8443 (accept the one-time browser warning: the certificate is self-signed) |
| HTTP | http://localhost:8080 (redirects to HTTPS) |
| Service 1 / 2 / 3 (direct) | http://localhost:5001, :5002, :5003 |
| Floci (fake AWS) | http://localhost:4566 |
| Postgres | localhost:5432 (user and password from `.env`) |

## All commands

Run `python scripts/dev.py help`. The useful ones: `down`, `reset` (also deletes the database volume), `logs s2`, `test`, `init`, `spike`.

## What is what

- **Floci** imitates AWS locally. It starts empty (`FLOCI_STORAGE_MODE=memory`), so run `python scripts/dev.py init` after every restart of Floci to create the bucket, secrets and log groups again (it is safe to run many times).
- **Postgres** stands in for RDS. Floci also lists an RDS service, but we use a plain Postgres container because it is simpler and the same SQL runs on real RDS.
- **nginx** is the only door for the browser: HTTPS on 8443, `/api/...` routed to the right service by prefix.
- `.env` is for local use only, is git-ignored and holds dummy values. Real secrets live in (fake) Secrets Manager.

## Problems

- `docker: not found` or "Docker is not running": start Docker Desktop, wait until it says running, open a new PowerShell.
- Port already in use (5432, 8443...): stop the other program, or change the left side of the port in `docker-compose.yml`.
- Browser says "not secure": expected locally (self-signed certificate).
- Something odd after a git pull: `python scripts/dev.py up` rebuilds changed services.
