#!/usr/bin/env python3
"""Helper for local development (works on Windows PowerShell, no bash or make needed).

Usage:  python scripts/dev.py <command>

  up         create .env + HTTPS certificate if missing, build and start everything
  down       stop everything (data volumes are kept)
  reset      stop everything AND delete the Postgres volume (fresh database)
  status     show running containers
  health     call /health of the three services through nginx (HTTPS)
  logs [x]   follow logs (optionally of one service: s1, s2, s3, nginx, floci, postgres)
  test       run the unit tests of the three services in throw-away Node containers
  init       create the AWS-like resources in Floci (bucket, secrets, logs, IAM, schedules)
  spike      run the Floci checks and write docs/FLOCI_SPIKE.md from the REAL output
  scheduler  start the fallback cron container (only if Floci cannot run the schedules)

EN: only the Python standard library is used, so nothing has to be installed on the host except Docker.
Franco: bnest3mel el Python el 3ady bas, f mafeesh 7aga lazem tet-install ela Docker.
"""
import os
import shutil
import ssl
import subprocess
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SERVICES = ["employee-training", "certificate-compliance", "dashboard-reports"]


def compose_base():
    cmd = ["docker", "compose", "-f", str(ROOT / "docker-compose.yml")]
    tools = ROOT / "docker-compose.tools.yml"
    if tools.exists():  # EN: arrives with the floci-init branch / Franco: bey-egy ma3 branch floci-init
        cmd += ["-f", str(tools)]
    return cmd


def run(cmd, **kw):
    print("> " + " ".join(str(c) for c in cmd))
    return subprocess.run(cmd, cwd=ROOT, **kw).returncode


def need_docker():
    if shutil.which("docker") is None:
        sys.exit("Docker was not found. Install Docker Desktop, start it, then open a NEW terminal.")
    if subprocess.run(["docker", "info"], capture_output=True).returncode != 0:
        sys.exit("Docker is installed but not running. Start Docker Desktop and wait until it says 'running'.")


def ensure_env():
    env, example = ROOT / ".env", ROOT / ".env.example"
    if not env.exists() and example.exists():
        shutil.copy(example, env)
        print("Created .env from .env.example (dummy local values; .env is git-ignored).")


def ensure_certs():
    certs = ROOT / "certs"
    if (certs / "server.crt").exists() and (certs / "server.key").exists():
        return
    certs.mkdir(exist_ok=True)
    print("Creating a self-signed HTTPS certificate (local only, git-ignored)...")
    code = run([
        "docker", "run", "--rm", "-v", f"{certs}:/certs", "alpine/openssl",
        "req", "-x509", "-nodes", "-newkey", "rsa:2048", "-days", "365",
        "-keyout", "/certs/server.key", "-out", "/certs/server.crt",
        "-subj", "/CN=localhost", "-addext", "subjectAltName=DNS:localhost,IP:127.0.0.1",
    ])
    if code != 0:
        sys.exit("Could not create the certificate. Is Docker running and online (it pulls alpine/openssl)?")


def cmd_up():
    need_docker()
    ensure_env()
    ensure_certs()
    code = run(compose_base() + ["up", "-d", "--build"])
    if code == 0:
        print("\nStarted. Next: python scripts/dev.py health")
        print("Browser: https://localhost:8443  (accept the one-time certificate warning)")
    return code


def cmd_health():
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE  # EN: self-signed certificate, local only / Franco: certificate self-signed, local bas
    bad = 0
    for name in ("s1", "s2", "s3"):
        url = f"https://localhost:8443/health/{name}"
        try:
            with urllib.request.urlopen(url, context=ctx, timeout=5) as r:
                print(f"OK    {url}  ->  {r.status} {r.read().decode()[:80]}")
        except Exception as e:  # noqa: BLE001 - we just print the reason
            bad += 1
            print(f"FAIL  {url}  ->  {e}")
    return 1 if bad else 0


def cmd_test():
    need_docker()
    failed = 0
    for svc in SERVICES:
        folder = ROOT / "services" / svc
        print(f"\n=== tests: {svc} ===")
        # EN: mount the whole "services" folder, because every service requires ../../common. The "frontend"
        #     folder is mounted too: some tests check the plain JS helpers of the pages (e.g. frontend/s1).
        # Franco: bnerkeb folder "services" kollo 3ashan kol service betesta3mel ../../common. W folder "frontend"
        #     kaman, 3ashan fe tests betet-check helpers el pages (zay frontend/s1).
        code = run([
            "docker", "run", "--rm", "-v", f"{ROOT / 'services'}:/app/services",
            "-v", f"{ROOT / 'frontend'}:/app/frontend",
            "-w", f"/app/services/{svc}", "node:20-alpine",
            "sh", "-c", "npm install --no-audit --no-fund && npm test",
        ])
        failed += 1 if code else 0
    print("\nALL TESTS PASSED" if not failed else f"\n{failed} service(s) have failing tests")
    return 1 if failed else 0


def main():
    args = sys.argv[1:]
    if not args or args[0] in ("-h", "--help", "help"):
        print(__doc__)
        return 0
    c, rest = args[0], args[1:]
    if c == "up":
        return cmd_up()
    if c == "health":
        return cmd_health()
    if c == "test":
        return cmd_test()
    need_docker()
    ensure_env()  # EN: docker-compose.yml needs the DB passwords from .env / Franco: docker-compose.yml me7tag passwords el database men .env
    base = compose_base()
    if c == "down":
        return run(base + ["down"])
    if c == "reset":
        return run(base + ["down", "-v"])
    if c == "status":
        return run(base + ["ps"])
    if c == "logs":
        return run(base + ["logs", "-f", "--tail=100"] + rest)
    if c in ("init", "spike"):
        if not (ROOT / "docker-compose.tools.yml").exists():
            sys.exit("docker-compose.tools.yml is missing (it comes with the floci-init branch). Pull the latest main.")
        ensure_env()
        run(base + ["up", "-d", "floci"])
        script = "init.py" if c == "init" else "spike.py"
        return run(base + ["--profile", "tools", "run", "--rm", "init", "python", script])
    if c == "scheduler":
        return run(base + ["--profile", "scheduler", "up", "-d", "--build", "scheduler"])
    print(f"Unknown command: {c}\n")
    print(__doc__)
    return 2


if __name__ == "__main__":
    sys.exit(main())
