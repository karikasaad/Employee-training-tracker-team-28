#!/usr/bin/env python3
"""Floci spike (everything except Cognito): checks what Floci REALLY supports and writes docs/FLOCI_SPIKE.md.

EN: run it with  python scripts/dev.py spike . Nothing is typed by hand: the report is built from the real answers.
Franco: shaghalha b  python scripts/dev.py spike . Mafeesh 7aga betetketeb b-eed: el report betetwalled men rodood Floci el 7a2i2eya.

Checks: S3 pre-signed URL expiry, bucket not public, Secrets Manager read, CloudWatch logs + filter + metric filter + alarm,
EventBridge schedule targets, KMS encrypt/decrypt. Secret VALUES are never printed (only their length).
Cognito checks come later, in a separate branch, after Kerolus's cognito setup is merged.
"""
import datetime
import json
import os
import sys
import time
import urllib.error
import urllib.request

import boto3
from botocore.config import Config

ENDPOINT = os.environ.get("AWS_ENDPOINT_URL", "http://floci:4566")
REGION = os.environ.get("AWS_DEFAULT_REGION", "us-east-1")
BUCKET = os.environ.get("CERTIFICATES_BUCKET", "certificates")
DOCS_DIR = os.environ.get("DOCS_DIR", "/work/docs")
OUT = os.path.join(DOCS_DIR, "FLOCI_SPIKE.md")


def client(name):
    return boto3.client(
        name, endpoint_url=ENDPOINT, region_name=REGION,
        aws_access_key_id=os.environ.get("AWS_ACCESS_KEY_ID", "test"),
        aws_secret_access_key=os.environ.get("AWS_SECRET_ACCESS_KEY", "test"),
        config=Config(retries={"max_attempts": 1}, s3={"addressing_style": "path"}),
    )


rows = []  # (check, result, evidence)


def short(x, n=300):
    s = str(x).replace("\n", " ").replace("|", "/")
    return s if len(s) <= n else s[:n] + "..."


def add(check, result, evidence):
    rows.append((check, result, short(evidence)))
    print(f"{result:14} {check}  |  {short(evidence, 160)}")


def http_get(url):
    try:
        with urllib.request.urlopen(url, timeout=10) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()


def attempt(check, fn):
    """EN: run a check; any exception is a real result ('Not supported' + the real error text).
    Franco: shaghal check; ay exception natiga 7a2i2eya ('Not supported' + nass el error el 7a2i2i)."""
    try:
        fn()
    except Exception as e:  # noqa: BLE001
        add(check, "Not supported", f"{type(e).__name__}: {e}")


# ----------------------------------------------------------------------------- S3
def check_s3():
    s3 = client("s3")
    try:
        s3.create_bucket(Bucket=BUCKET)
    except Exception:  # noqa: BLE001 - already exists is fine
        pass
    key = "spike/presign-test.txt"
    s3.put_object(Bucket=BUCKET, Key=key, Body=b"hello spike")
    add("S3 put_object", "Works", f"stored {BUCKET}/{key}")

    status, body = http_get(f"{ENDPOINT}/{BUCKET}/{key}")
    if status in (401, 403):
        add("S3 object is NOT readable without a signature", "Works", f"anonymous GET -> HTTP {status}")
    else:
        add("S3 object is NOT readable without a signature", "Not enforced", f"anonymous GET -> HTTP {status} (bucket data readable without signing)")

    url = s3.generate_presigned_url("get_object", Params={"Bucket": BUCKET, "Key": key}, ExpiresIn=5)
    s1, b1 = http_get(url)
    time.sleep(7)
    s2, _ = http_get(url)
    if s1 == 200 and s2 in (400, 401, 403):
        add("S3 pre-signed URL expiry (ExpiresIn=5s)", "Works", f"before expiry HTTP {s1}; 7s later HTTP {s2} (expiry is enforced, so 5 minutes will be too)")
    elif s1 == 200 and s2 == 200:
        add("S3 pre-signed URL expiry (ExpiresIn=5s)", "Partial", f"URL works (HTTP {s1}) but STILL works after 7s (HTTP {s2}): expiry NOT enforced by Floci")
    else:
        add("S3 pre-signed URL expiry (ExpiresIn=5s)", "Not supported", f"before expiry HTTP {s1}; after HTTP {s2}")

    def versioning_and_block():
        v = s3.get_bucket_versioning(Bucket=BUCKET).get("Status")
        p = s3.get_public_access_block(Bucket=BUCKET)["PublicAccessBlockConfiguration"]
        add("S3 versioning + public access block (read back)", "Works" if v == "Enabled" and all(p.values()) else "Partial",
            f"versioning={v}, publicAccessBlock={p}")
    attempt("S3 versioning + public access block (read back)", versioning_and_block)

    def encryption():
        e = s3.get_bucket_encryption(Bucket=BUCKET)["ServerSideEncryptionConfiguration"]["Rules"][0]["ApplyServerSideEncryptionByDefault"]
        add("S3 default encryption (read back)", "Works", e)
    attempt("S3 default encryption (read back)", encryption)


# ----------------------------------------------------------------------------- Secrets
def check_secrets():
    sm = client("secretsmanager")
    value = sm.get_secret_value(SecretId="ett/sendgrid")["SecretString"]
    add("Secrets Manager get_secret_value ett/sendgrid", "Works", f"read OK, length {len(value)} (value not printed)")
    names = [s["Name"] for s in sm.list_secrets().get("SecretList", [])]
    add("Secrets Manager list_secrets", "Works", f"{names}")


# ----------------------------------------------------------------------------- CloudWatch
def check_logs():
    logs = client("logs")
    group, stream = "/ett/spike", "spike-stream"
    for fn in (lambda: logs.create_log_group(logGroupName=group), lambda: logs.create_log_stream(logGroupName=group, logStreamName=stream)):
        try:
            fn()
        except Exception:  # noqa: BLE001 - already exists
            pass
    now = int(time.time() * 1000)
    logs.put_log_events(logGroupName=group, logStreamName=stream, logEvents=[
        {"timestamp": now, "message": json.dumps({"event": "auth_failure", "status": 401, "path": "/api/x"})},
        {"timestamp": now + 1, "message": json.dumps({"event": "forbidden", "status": 403, "path": "/api/y"})},
        {"timestamp": now + 2, "message": json.dumps({"event": "ok", "status": 200, "path": "/health"})},
    ])
    add("CloudWatch Logs put_log_events", "Works", "3 events written to /ett/spike")
    time.sleep(1)
    found = logs.filter_log_events(logGroupName=group, filterPattern="auth_failure").get("events", [])
    add("CloudWatch Logs filter_log_events (pattern auth_failure)", "Works" if found else "Partial", f"{len(found)} event(s) matched (expected at least 1)")

    def metric_filter():
        logs.put_metric_filter(logGroupName=group, filterName="ett-401-403", filterPattern="?auth_failure ?forbidden",
                               metricTransformations=[{"metricName": "AuthFailures", "metricNamespace": "ETT", "metricValue": "1"}])
        got = logs.describe_metric_filters(logGroupName=group).get("metricFilters", [])
        add("CloudWatch metric filter", "Works" if got else "Partial", f"{len(got)} filter(s) listed")
    attempt("CloudWatch metric filter", metric_filter)

    def alarm():
        cw = client("cloudwatch")
        cw.put_metric_alarm(AlarmName="ett-auth-failures", Namespace="ETT", MetricName="AuthFailures", Statistic="Sum",
                            Period=300, EvaluationPeriods=1, Threshold=5, ComparisonOperator="GreaterThanOrEqualToThreshold")
        got = cw.describe_alarms(AlarmNames=["ett-auth-failures"]).get("MetricAlarms", [])
        add("CloudWatch alarm (>=5 failures in 5 min)", "Works (created)" if got else "Partial", f"{len(got)} alarm(s) listed; whether it FIRES is not tested here")
    attempt("CloudWatch alarm (>=5 failures in 5 min)", alarm)


# ----------------------------------------------------------------------------- Scheduler targets
def check_scheduler():
    def events_rule():
        ev = client("events")
        ev.put_rule(Name="ett-spike-rule", ScheduleExpression="rate(1 day)", State="DISABLED")
        got = ev.list_rules(NamePrefix="ett-spike").get("Rules", [])
        add("EventBridge scheduled rule (put_rule)", "Works (created)" if got else "Partial", f"{len(got)} rule(s) listed")
    attempt("EventBridge scheduled rule (put_rule)", events_rule)

    def api_destination():
        ev = client("events")
        conn = ev.create_connection(Name="ett-spike-conn", AuthorizationType="API_KEY",
                                    AuthParameters={"ApiKeyAuthParameters": {"ApiKeyName": "x-key", "ApiKeyValue": "dummy"}})["ConnectionArn"]
        dest = ev.create_api_destination(Name="ett-spike-dest", ConnectionArn=conn, InvocationEndpoint="http://s2:5002/api/compliance/run-check", HttpMethod="POST")
        add("EventBridge API destination (HTTP target)", "Works (created)", f"{dest.get('ApiDestinationArn')}; actually CALLING the URL on schedule is not verified")
    attempt("EventBridge API destination (HTTP target)", api_destination)

    def scheduler_api():
        sch = client("scheduler")
        sch.create_schedule(Name="ett-spike-schedule", ScheduleExpression="rate(1 day)", FlexibleTimeWindow={"Mode": "OFF"},
                            State="DISABLED", Target={"Arn": "arn:aws:scheduler:::aws-sdk:sqs:sendMessage", "RoleArn": "arn:aws:iam::000000000000:role/ett-s2-role", "Input": "{}"})
        add("EventBridge Scheduler create_schedule", "Works (created)", "accepted; HTTP endpoints are not a direct Scheduler target type in AWS, so we use rules + API destinations or the cron container")
    attempt("EventBridge Scheduler create_schedule", scheduler_api)


# ----------------------------------------------------------------------------- KMS
def check_kms():
    kms = client("kms")
    key = kms.create_key(Description="spike key")["KeyMetadata"]["KeyId"]
    cipher = kms.encrypt(KeyId=key, Plaintext=b"secret-data")["CiphertextBlob"]
    plain = kms.decrypt(CiphertextBlob=cipher)["Plaintext"]
    add("KMS create_key + encrypt + decrypt round trip", "Works" if plain == b"secret-data" else "Partial", f"decrypted bytes match: {plain == b'secret-data'}")


# EN: our decision for each check that does not behave like AWS. The RESULT column still comes from the real run;
#     this text only says what we do about it. A check that is not in this table and is not "Works" gets a
#     generic line, so no row is ever left empty.
# Franco: el qarar bta3na le kol check mesh zay AWS. Column el RESULT lessa gay men el run el 7a2i2i; el kalam da
#     bas beyqool e7na hane3mel eh. Law check mesh hena w mesh "Works" beyakhod gomla 3ama, f mafeesh satr fadi.
DECISIONS = {
    "S3 object is NOT readable without a signature":
        "Floci serves objects without a signature. The app never hands out the bucket address: files leave only through S2 "
        "(role + owner/team check) and a 5-minute pre-signed link. On AWS: Block Public Access ON and a bucket policy that denies non-TLS.",
    "S3 pre-signed URL expiry (ExpiresIn=5s)":
        "Floci does not enforce the expiry. We still sign every link for exactly 300 s (X-Amz-Expires=300), and the S2 tests check that value. "
        "Real expiry can only be shown on AWS.",
    "S3 versioning + public access block (read back)":
        "Floci cannot read these settings back. init.py sets them when the bucket is created; to prove them run get-bucket-versioning "
        "and get-public-access-block on real AWS.",
    "S3 default encryption (read back)":
        "Floci cannot read the encryption setting back. init.py requests SSE (KMS) at creation; to prove it run get-bucket-encryption on real AWS.",
    "CloudWatch alarm (>=5 failures in 5 min)":
        "The alarm is created, but Floci does not evaluate it. The suspicious-activity script writes the failures, and the log queries show them as evidence. "
        "On AWS the alarm moves to ALARM and notifies through SNS.",
    "EventBridge scheduled rule (put_rule)":
        "The rule is stored, but nothing is verified about it running. The daily check is started by the cron container (infra/scheduler) with a service token.",
    "EventBridge API destination (HTTP target)":
        "Calling the URL on schedule is not verified on Floci. The cron container does the call here; on AWS use rule + API destination with OAuth client credentials.",
    "EventBridge Scheduler create_schedule":
        "Scheduler's targets are AWS APIs, not plain HTTP endpoints. We use an EventBridge rule + API destination on AWS, and the cron container locally.",
}
CHECK_NOT_IN_TABLE = "See docs/LIMITATIONS.md."
COGNITO_START = "<!-- cognito-spike:start -->"
COGNITO_END = "<!-- cognito-spike:end -->"


def decision_for(check, result):
    if result == "Works":
        return "-"
    return DECISIONS.get(check, CHECK_NOT_IN_TABLE)


def kept_cognito_block():
    """EN: cognito_spike.js writes its own section into the same file; keep it when this script rewrites the file.
    Franco: cognito_spike.js beyekteb section bta3o fe nafs el file; bnesibo lama el script da yekteb el file men el awel."""
    try:
        with open(OUT, encoding="utf-8") as f:
            text = f.read()
    except OSError:
        return ""
    a, b = text.find(COGNITO_START), text.find(COGNITO_END)
    return text[a:b + len(COGNITO_END)] if 0 <= a < b else ""


def write_report():
    os.makedirs(DOCS_DIR, exist_ok=True)
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    lines = [
        "# Floci spike (everything except Cognito)",
        "",
        f"Generated by `infra/floci/spike.py` on {stamp} against `{ENDPOINT}`. Every result below comes from the real run; nothing was typed by hand.",
        "Cognito (groups claim, token lifetime, MFA, GlobalSignOut) is tested by `infra/floci/cognito/cognito_spike.js`; its section is at the end of this file.",
        "",
        "| Check | Result | Evidence (real output) | Workaround / decision |",
        "| --- | --- | --- | --- |",
    ]
    for check, result, evidence in rows:
        lines.append(f"| {check} | {result} | {evidence} | {decision_for(check, result)} |")
    lines += ["", "Result words: **Works** = behaves like AWS here. **Works (created)** = the API accepted it, behaviour not verified. "
              "**Partial / Not enforced** = answers but differs from AWS. **Not supported** = error (shown in the evidence column).", ""]
    block = kept_cognito_block()
    if block:
        lines += [block, ""]
    with open(OUT, "w", encoding="utf-8", newline="\n") as f:
        f.write("\n".join(lines))
    print(f"\nWrote {OUT}")


def main():
    print(f"Floci spike against {ENDPOINT}\n")
    attempt("S3 checks", check_s3)
    attempt("Secrets Manager checks", check_secrets)
    attempt("CloudWatch Logs checks", check_logs)
    check_scheduler()
    attempt("KMS checks", check_kms)
    write_report()
    print("Docs/FLOCI_SPIKE.md is written from the real answers (the last column holds our decision for each row that is not 'Works'). Check it, then commit it.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
