#!/usr/bin/env python3
"""Creates the AWS-like resources in Floci. SAFE TO RUN MANY TIMES (idempotent).

EN: run it with  python scripts/dev.py init  (it runs inside a small Docker container, nothing to install).
Franco: shaghalha b  python scripts/dev.py init  (betetshaghal gowwa container so8ayyar, mafeesh install).

What it creates: KMS key, private encrypted S3 bucket, 3 secrets (never overwritten), 3 log groups,
least-privilege IAM policies + roles (from infra/iam/*.json), and the two daily schedules.
Each step prints OK / SKIPPED / FAILED. SKIPPED = Floci does not support it (written to docs/LIMITATIONS.md).
Exit code 0 unless a step FAILED for a real reason.
"""
import glob
import json
import os
import sys
import time

import boto3
from botocore.config import Config
from botocore.exceptions import ClientError, EndpointConnectionError

ENDPOINT = os.environ.get("AWS_ENDPOINT_URL", "http://floci:4566")
REGION = os.environ.get("AWS_DEFAULT_REGION", "us-east-1")
BUCKET = os.environ.get("CERTIFICATES_BUCKET", "certificates")
IAM_DIR = os.environ.get("IAM_DIR", "/work/iam")
S2_URL = os.environ.get("S2_URL", "http://s2:5002")
S3_URL = os.environ.get("S3_URL", "http://s3:5003")
KEY_ALIAS = "alias/ett-certificates"

# EN: answers from AWS that simply mean "it was already there" - not an error when we run twice.
# Franco: rodood men AWS ma3nahaha "mawgood abl keda" - mesh error lama nshaghal marteen.
ALREADY = {
    "BucketAlreadyOwnedByYou", "BucketAlreadyExists", "ResourceExistsException",
    "ResourceAlreadyExistsException", "EntityAlreadyExists", "EntityAlreadyExistsException",
    "ConflictException", "AlreadyExistsException", "AlreadyExists",
}
# EN: answers that mean "Floci does not implement this call".
# Franco: rodood ma3nahaha "Floci mesh beyedaam el call di".
UNSUPPORTED = {"NotImplemented", "NotImplementedException", "UnsupportedOperation", "InvalidAction",
               "UnknownOperationException", "UnrecognizedClientException", "MethodNotAllowed"}

results = []


def client(name):
    return boto3.client(
        name,
        endpoint_url=ENDPOINT,
        region_name=REGION,
        aws_access_key_id=os.environ.get("AWS_ACCESS_KEY_ID", "test"),
        aws_secret_access_key=os.environ.get("AWS_SECRET_ACCESS_KEY", "test"),
        config=Config(retries={"max_attempts": 2}, s3={"addressing_style": "path"}),
    )


def record(name, status, detail=""):
    results.append((name, status, detail))
    print(f"  {status:8} {name}" + (f"  - {detail}" if detail else ""))


def step(name, fn):
    """Run one step and record OK / SKIPPED / FAILED. Returns fn's result or None."""
    try:
        out = fn()
        record(name, "OK", "created or updated")
        return out
    except ClientError as e:
        code = e.response.get("Error", {}).get("Code", "")
        http = e.response.get("ResponseMetadata", {}).get("HTTPStatusCode", 0)
        msg = e.response.get("Error", {}).get("Message", "")[:120]
        if code in ALREADY:
            record(name, "OK", "already existed")
        elif code in UNSUPPORTED or http == 501:
            record(name, "SKIPPED", f"Floci does not support this ({code})")
        else:
            record(name, "FAILED", f"{code}: {msg}")
    except Exception as e:  # noqa: BLE001 - we want to report any problem, not crash
        record(name, "FAILED", f"{type(e).__name__}: {str(e)[:120]}")
    return None


def wait_for_floci(seconds=90):
    s3 = client("s3")
    end = time.time() + seconds
    while time.time() < end:
        try:
            s3.list_buckets()
            print(f"Floci is answering at {ENDPOINT}")
            return
        except Exception:  # noqa: BLE001
            time.sleep(2)
    sys.exit(f"Floci did not answer at {ENDPOINT} within {seconds}s. Run: python scripts/dev.py up")


# ----------------------------------------------------------------------------- KMS
def get_or_create_key():
    kms = client("kms")
    for alias in kms.list_aliases().get("Aliases", []):
        if alias.get("AliasName") == KEY_ALIAS and alias.get("TargetKeyId"):
            return alias["TargetKeyId"]
    key_id = kms.create_key(Description="ETT certificates bucket key")["KeyMetadata"]["KeyId"]
    kms.create_alias(AliasName=KEY_ALIAS, TargetKeyId=key_id)
    return key_id


# ----------------------------------------------------------------------------- S3
def make_bucket(s3):
    # EN: us-east-1 must NOT send a LocationConstraint. / Franco: us-east-1 mamnoo3 teb3at feha LocationConstraint.
    s3.create_bucket(Bucket=BUCKET)


def block_public(s3):
    s3.put_public_access_block(
        Bucket=BUCKET,
        PublicAccessBlockConfiguration={
            "BlockPublicAcls": True, "IgnorePublicAcls": True,
            "BlockPublicPolicy": True, "RestrictPublicBuckets": True,
        },
    )


def enable_versioning(s3):
    s3.put_bucket_versioning(Bucket=BUCKET, VersioningConfiguration={"Status": "Enabled"})


def enable_encryption(s3, key_id):
    rule = {"SSEAlgorithm": "aws:kms", "KMSMasterKeyID": key_id} if key_id else {"SSEAlgorithm": "AES256"}
    s3.put_bucket_encryption(
        Bucket=BUCKET,
        ServerSideEncryptionConfiguration={"Rules": [{"ApplyServerSideEncryptionByDefault": rule}]},
    )


# ----------------------------------------------------------------------------- Secrets
def secrets_to_create():
    # EN: dummy local values only. The REAL SendGrid key is added by hand later and never committed.
    # Franco: values wahmeya lel local bas. El SendGrid key el 7a2i2i bet-etzawwed b-eedena w mabet-etrafe3sh.
    db = {
        "host": os.environ.get("DB_HOST", "postgres"),
        "port": os.environ.get("DB_PORT", "5432"),
        "dbname": os.environ.get("DB_NAME", "ett"),
        "username": os.environ.get("POSTGRES_USER", "ett_admin"),
        "password": os.environ.get("POSTGRES_PASSWORD", "local-dev-only-change-me"),
    }
    return {
        "ett/db": json.dumps(db),
        "ett/sendgrid": "REPLACE_ME_WITH_REAL_SENDGRID_KEY",
        "ett/service-client": json.dumps({"client_id": "REPLACE_ME", "client_secret": "REPLACE_ME", "token_url": ""}),
    }


# ----------------------------------------------------------------------------- IAM
def account_id():
    try:
        return client("sts").get_caller_identity()["Account"]
    except Exception:  # noqa: BLE001
        return "000000000000"


def load_json(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


# ----------------------------------------------------------------------------- schedules
def make_schedules(role_arn):
    """EN: EventBridge scheduled rules -> API destinations -> POST to S2/S3 daily jobs.
    Franco: rules mewa3ada fel EventBridge -> API destination -> POST lel jobs el yomeya bta3et S2 w S3."""
    events = client("events")
    token_url = os.environ.get("COGNITO_TOKEN_URL", "http://floci:4566/oauth2/token")
    conn = events.create_connection(
        Name="ett-service-client",
        AuthorizationType="OAUTH_CLIENT_CREDENTIALS",
        AuthParameters={"OAuthParameters": {
            "AuthorizationEndpoint": token_url,
            "HttpMethod": "POST",
            "ClientParameters": {"ClientID": "REPLACE_ME", "ClientSecret": "REPLACE_ME"},
        }},
    )["ConnectionArn"]
    jobs = [
        ("ett-s2-run-check", "cron(0 1 * * ? *)", f"{S2_URL}/api/compliance/run-check"),
        ("ett-s3-run-snapshot", "cron(30 1 * * ? *)", f"{S3_URL}/api/dashboard/run-snapshot"),
    ]
    for name, cron, url in jobs:
        dest = events.create_api_destination(
            Name=name, ConnectionArn=conn, InvocationEndpoint=url, HttpMethod="POST",
        )["ApiDestinationArn"]
        events.put_rule(Name=name, ScheduleExpression=cron, State="ENABLED")
        events.put_targets(Rule=name, Targets=[{"Id": name, "Arn": dest, "RoleArn": role_arn}])


def main():
    print(f"Floci endpoint: {ENDPOINT}   region: {REGION}   bucket: {BUCKET}")
    wait_for_floci()

    print("\n[KMS]")
    key_id = step("kms key + alias " + KEY_ALIAS, get_or_create_key)

    print("\n[S3]")
    s3 = client("s3")
    step(f"bucket {BUCKET}", lambda: make_bucket(s3))
    step("block all public access", lambda: block_public(s3))
    step("versioning on", lambda: enable_versioning(s3))
    step("default encryption (KMS)", lambda: enable_encryption(s3, key_id))

    print("\n[Secrets Manager]  (existing secrets are never overwritten)")
    sm = client("secretsmanager")
    for name, value in secrets_to_create().items():
        step(f"secret {name}", lambda n=name, v=value: sm.create_secret(Name=n, SecretString=v))

    print("\n[CloudWatch Logs]")
    logs = client("logs")
    for group in ("/ett/s1", "/ett/s2", "/ett/s3"):
        step(f"log group {group}", lambda g=group: logs.create_log_group(logGroupName=g))
        step(f"retention 7 days {group}", lambda g=group: logs.put_retention_policy(logGroupName=g, retentionInDays=7))

    print("\n[IAM least privilege]  (policies from infra/iam/*.json)")
    iam = client("iam")
    acct = account_id()
    trust = json.dumps(load_json(os.path.join(IAM_DIR, "trust-policy.json")))
    role_arn = f"arn:aws:iam::{acct}:role/ett-s2-role"
    for path in sorted(glob.glob(os.path.join(IAM_DIR, "s*-policy.json"))):
        svc = os.path.basename(path).split("-")[0]  # s1 / s2 / s3
        doc = json.dumps(load_json(path))
        step(f"policy ett-{svc}", lambda n=svc, d=doc: iam.create_policy(PolicyName=f"ett-{n}", PolicyDocument=d))
        step(f"role ett-{svc}-role", lambda n=svc: iam.create_role(RoleName=f"ett-{n}-role", AssumeRolePolicyDocument=trust))
        step(f"attach policy to role ett-{svc}-role", lambda n=svc: iam.attach_role_policy(
            RoleName=f"ett-{n}-role", PolicyArn=f"arn:aws:iam::{acct}:policy/ett-{n}"))

    print("\n[Daily schedules]  (01:00 UTC S2 check, 01:30 UTC S3 snapshot)")
    step("EventBridge schedule rules + API destinations", lambda: make_schedules(role_arn))

    ok = sum(1 for r in results if r[1] == "OK")
    skipped = [r for r in results if r[1] == "SKIPPED"]
    failed = [r for r in results if r[1] == "FAILED"]
    print(f"\nSUMMARY: {ok} OK, {len(skipped)} SKIPPED, {len(failed)} FAILED")
    for name, _, detail in skipped:
        print(f"  not supported by Floci: {name} ({detail}) -> write it in docs/LIMITATIONS.md")
    if any("schedule" in r[0] for r in skipped + failed):
        print("  schedules: use the fallback cron container instead:  python scripts/dev.py scheduler")
    for name, _, detail in failed:
        print(f"  FAILED: {name}: {detail}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
