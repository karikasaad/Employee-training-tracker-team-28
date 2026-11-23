# API Contract: Employee Training Tracker (Team 28)

> **Owner:** Kerolus. This is the agreement every service and frontend page is built against. Change it only through a pull request reviewed by the owners of the affected services.
> **Version:** 1.1 (adds 4.6b `PUT /api/trainings/{id}`). Stack: Node.js 22 + Express, PostgreSQL, Amazon Cognito, S3, Secrets Manager and CloudWatch (simulated on Floci).

## Contents
1. [Conventions](#1-conventions-all-services)
2. [Authentication, roles and ownership](#2-authentication-roles-and-ownership)
3. [Common JSON shapes](#3-common-json-shapes)
4. [S1 Employee & Training](#4-s1-employee--training-port-5001)
5. [S2 Certificate & Compliance](#5-s2-certificate--compliance-port-5002)
6. [S3 Manager Dashboard & Reports](#6-s3-manager-dashboard--reports-port-5003)
7. [Service-to-service calls](#7-service-to-service-calls)
8. [Business rules (reference)](#8-business-rules-reference)

---

## 1. Conventions (all services)

| Topic | Rule |
|---|---|
| Base URL | `https://localhost:8443` through nginx. nginx routes by path prefix (table below). Inside Docker, services call each other at `S1_URL`, `S2_URL` and `S3_URL` from the environment. |
| Format | JSON (`Content-Type: application/json`). Two exceptions: the certificate upload is `multipart/form-data`, and the CSV export is `text/csv`. Field names are **camelCase**. |
| IDs | UUID strings, e.g. `"20000000-0000-4000-8000-000000000002"`. A malformed id returns **400**; a well-formed id that does not exist returns **404**. |
| Dates | `dueDate`, `issueDate` and `expiryDate` are calendar dates `"YYYY-MM-DD"`. Timestamps such as `assignedAt` and `completedAt` are ISO 8601 in UTC, e.g. `"2026-11-22T09:00:00.000Z"`. "Today" always means today's **UTC** date. |
| Auth | Every endpoint except `GET /health` needs `Authorization: Bearer <Cognito access token>`. |
| Unknown fields | Unknown body fields are ignored. Unknown query values for enumerations return **400**. |
| Body size | JSON bodies are limited to 100 KB (**413** if larger). Uploads are limited to 5 MB. |
| Request id | Clients may send `X-Request-Id`. Every service logs it and forwards it on service-to-service calls. If it is missing, the service creates one and returns it in the `X-Request-Id` response header. |

**nginx routing**

| Path prefix | Service |
|---|---|
| `/api/employees`, `/api/teams`, `/api/trainings`, `/api/assignments` | S1 `:5001` |
| `/api/certificates`, `/api/compliance` | S2 `:5002` |
| `/api/dashboard`, `/api/reports` | S3 `:5003` |

**Error body (every 4xx/5xx, every service)**

```json
{ "error": { "code": "VALIDATION_ERROR", "message": "dueDate must be today or later", "details": [ { "field": "dueDate", "issue": "in the past" } ] } }
```

| Status | `code` | When |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Bad body, query, id format or date. `details` lists the fields. |
| 401 | `UNAUTHENTICATED` | Token missing, malformed, expired, bad signature, wrong issuer/client or wrong `token_use`. |
| 403 | `FORBIDDEN` | Valid token, but the wrong role, or not the owner or the team's manager. |
| 404 | `NOT_FOUND` | Unknown id or route. |
| 409 | `CONFLICT` | Duplicate open assignment, assignment already completed, certificate no longer Pending. |
| 413 | `PAYLOAD_TOO_LARGE` | Body or file over the limit. |
| 415 | `UNSUPPORTED_MEDIA_TYPE` | File type not allowed (checked by magic bytes), or wrong `Content-Type`. |
| 502 / 503 | `UPSTREAM_ERROR` / `UPSTREAM_UNAVAILABLE` | Another service failed or timed out. Never return partial numbers. |
| 500 | `INTERNAL_ERROR` | Unexpected error. The message is generic: no stack trace or SQL. |

---

## 2. Authentication, roles and ownership

**Token.** The frontend signs in with Cognito and sends the **access token**. `services/common/auth.js` checks, on every request:
- the RS256 signature against the user pool JWKS;
- `iss` equals `COGNITO_ISSUER`;
- `client_id` is the web client or the service client;
- `token_use` is `"access"`;
- `exp` is in the future.

Any failure returns **401**. Access tokens live **15 minutes**.

**Roles.**

| Role | Comes from | Who |
|---|---|---|
| `Employee` | Cognito group `Employee` | staff |
| `Manager` | Cognito group `Manager` | team leads; a manager is also an employee of their own team |
| `Service` | access token issued to the **service client** (client-credentials flow) | the scheduled jobs only; never a person |

**Identity.**
- The token's `sub` maps to `employees.cognito_sub`.
- S1 resolves it to the caller's `employeeId`.
- S2 and S3 never read S1's tables. When they need the caller's `employeeId` or team, they call `GET /api/employees/me` on S1 with the caller's token. They may cache the answer for the length of one request.
- Self-service routes **never trust an `employeeId` from the body or the URL.** The id always comes from the token.

**Ownership.**
- **"Manager of team X"** means `teams.managerId == caller's employeeId`. Each team has exactly one manager.
- **S2 and S3 check team ownership through S1.** They call `GET /api/teams` with the caller's token: it returns only the teams the caller manages. If `{teamId}` is not in that list, they return **403**.
- **Only the owner or the team's manager.** An employee can only see and change their own data. A manager can see their own team's data, never another team's. Anything else returns **403**.

**Service token.**
- Jobs get a token with the client-credentials flow (client id and secret are in Secrets Manager `ett/service-client`).
- Only endpoints marked **Service** accept it.
- A Service token on a person-only route returns **403**.

---

## 3. Common JSON shapes

### Assignment

```json
{
  "id": "40000000-0000-4000-8000-000000000001",
  "employeeId": "20000000-0000-4000-8000-000000000002",
  "employeeName": "Ahmed Ali",
  "trainingId": "30000000-0000-4000-8000-000000000001",
  "trainingName": "Fire Safety",
  "category": "Safety",
  "requiresCertificate": true,
  "assignedBy": "20000000-0000-4000-8000-000000000001",
  "assignedAt": "2026-10-13T08:00:00.000Z",
  "dueDate": "2026-11-12",
  "completedAt": null,
  "status": "Overdue",
  "daysOverdue": 10,
  "renewalOfId": null
}
```

| Field | Type | Notes |
|---|---|---|
| `employeeId`, `trainingId` | uuid | |
| `category` | string | copied from the training; S2 and S3 rely on it |
| `requiresCertificate` | boolean | copied from the training; S2 relies on it for Missing flags |
| `dueDate` | `"YYYY-MM-DD"` | |
| `completedAt` | ISO timestamp or `null` | `null` = not completed |
| `status` | `"Assigned"` \| `"Completed"` \| `"Overdue"` | **calculated on read, never stored** (see section 8) |
| `daysOverdue` | integer | `0` unless status is `Overdue`; then `today - dueDate` in days |
| `renewalOfId` | uuid or `null` | set when this assignment was created by the renewal rule |

### Employee

```json
{ "id": "20000000-0000-4000-8000-000000000002", "name": "Ahmed Ali", "email": "ahmed@example.com",
  "teamId": "10000000-0000-4000-8000-000000000001", "teamName": "Operations",
  "managerId": "20000000-0000-4000-8000-000000000001", "role": "Employee" }
```

`role` is `"Manager"` if this employee manages their team, otherwise `"Employee"`.

### Team

```json
{ "id": "10000000-0000-4000-8000-000000000001", "name": "Operations",
  "managerId": "20000000-0000-4000-8000-000000000001", "managerName": "Mona Hassan", "employeeCount": 4 }
```

### Training

```json
{ "id": "30000000-0000-4000-8000-000000000001", "name": "Fire Safety", "category": "Safety",
  "requiresCertificate": true, "validityMonths": 12,
  "createdBy": "20000000-0000-4000-8000-000000000001", "createdAt": "2026-11-01T10:00:00.000Z" }
```

`validityMonths` is `null` when the training never expires.

### Certificate

```json
{ "id": "50000000-0000-4000-8000-000000000001", "employeeId": "20000000-0000-4000-8000-000000000003",
  "trainingId": "30000000-0000-4000-8000-000000000001", "title": "Fire Safety Certificate",
  "issuer": "Seed Training Institute", "certificateNumber": "FS-1001",
  "issueDate": "2026-09-18", "expiryDate": "2027-09-18",
  "reviewStatus": "Verified", "validity": "Valid",
  "mimeType": "application/pdf", "sizeBytes": 120000, "uploadedAt": "2026-09-18T10:00:00.000Z",
  "verifiedBy": "20000000-0000-4000-8000-000000000001", "verifiedAt": "2026-09-19T11:00:00.000Z",
  "rejectReason": null }
```

- `reviewStatus` is `"Pending"`, `"Verified"` or `"Rejected"`.
- `validity` is `"Valid"`, `"Expiring soon"` or `"Expired"`, calculated from `expiryDate`.
- Only **Verified** certificates count for compliance.
- `s3Key` and `fileHash` are never returned.

### ComplianceRow (S3)

```json
{ "employeeId": "20000000-0000-4000-8000-000000000002", "name": "Ahmed Ali",
  "status": "Non-compliant", "reasons": ["OverdueTraining"],
  "expiringSoon": false, "daysOverdueMax": 10, "soonestExpiry": null }
```

`reasons` ⊆ `["OverdueTraining", "CertificateMissing", "CertificateExpired"]`. It is empty when the employee is Compliant.

---

## 4. S1 Employee & Training (port 5001)

**Owner: Kerolus. Tables:** `teams`, `employees`, `trainings`, `assignments`. S1 calls no other service.

### 4.1 `GET /api/employees/me`

Returns the caller's own profile, including `teamName` and `managerId`.

- **Roles:** Employee, Manager.
- **200:** `Employee`.
- **Errors:** 401; 404 if the token is valid but no employee has this `sub` (user not provisioned).

### 4.2 `GET /api/employees/{id}`

The employee lookup that S2 and S3 use.

- **Roles:** the employee themself; the manager of that employee's team; Service.
- **200:** `Employee`.
- **Errors:** 400 (bad uuid), 401, 403 (anyone else), 404.

### 4.3 `GET /api/teams`

- **Roles:** Manager; Service.
- **200:** `[Team]`. A Manager gets **only the teams they manage**; Service gets all teams.
- **Errors:** 401; 403 for an Employee.

### 4.4 `GET /api/teams/{teamId}/employees`

- **Roles:** the manager of `teamId`; Service.
- **200:** `[Employee]`, ordered by name.
- **Errors:** 400, 401, 403 (Employee, or the manager of another team), 404 (unknown team).

### 4.5 `GET /api/teams/{teamId}/assignments?status=`

The team view, with **calculated** status.

- **Roles:** the manager of `teamId`; Service.
- **Query:** `status` is optional: `overdue`, `completed` or `assigned` (case-insensitive). Anything else returns 400.
- **200:** `[Assignment]` (with `employeeName`), ordered by `dueDate`.
- **Errors:** 400, 401, 403, 404.

### 4.6 `POST /api/trainings`

- **Roles:** Manager.
- **Body:**

```json
{ "name": "Fire Safety", "category": "Safety", "requiresCertificate": true, "validityMonths": 12 }
```

- **Validation:**
  - `name`: 1–150 chars, unique.
  - `category`: 1–50 chars.
  - `requiresCertificate`: boolean, default `false`.
  - `validityMonths`: integer 1–120 or `null`.
- **201:** `Training`.
- **Errors:** 400; 401; 403 (Employee); 409 (name already exists).

### 4.6b `PUT /api/trainings/{id}`

Edit a training. Added in v1.1.

- **Roles:** Manager, and only the manager who **created** the training (`createdBy`). Another manager gets 403.
- **Body:** the same four fields as 4.6, all sent again (full replacement):

```json
{ "name": "Fire Safety", "category": "Safety", "requiresCertificate": true, "validityMonths": 24 }
```

- **Validation:** the same as 4.6.
- **Effect:** changes apply to future assignments and renewals. Completed assignments are not rewritten.
- **200:** `Training`.
- **Errors:** 400, 401, 403, 404, 409 (name already used by another training).

### 4.7 `GET /api/trainings?category=`

- **Roles:** Employee, Manager.
- **Query:** `category` is optional; exact match, 1–50 chars. Values are passed as SQL parameters, so an injection string simply matches nothing.
- **200:** `[Training]`, ordered by name.
- **Errors:** 400, 401.

### 4.8 `GET /api/trainings/{id}`

- **Roles:** Employee, Manager, Service.
- **200:** `Training`.
- **Errors:** 400, 401, 404.

### 4.9 `POST /api/assignments`

- **Roles:** Manager, and only for their own team.
- **Body:** give exactly one of `employeeId` or `teamId`.

```json
{ "employeeId": "20000000-0000-4000-8000-000000000003", "trainingId": "30000000-0000-4000-8000-000000000002", "dueDate": "2026-12-31" }
```

```json
{ "teamId": "10000000-0000-4000-8000-000000000001", "trainingId": "30000000-0000-4000-8000-000000000002", "dueDate": "2026-12-31" }
```

- **Validation:**
  - exactly one of `employeeId` or `teamId`;
  - `trainingId` is a uuid;
  - `dueDate` is a valid `YYYY-MM-DD` that is **today or later**, otherwise 400.
- **201, single employee:** `Assignment`.
- **201, whole team:** every team member gets the training. Members who already have it **open** are skipped, not failed:

```json
{ "created": [ { "...Assignment...": "" } ],
  "skipped": [ { "employeeId": "20000000-0000-4000-8000-000000000002", "reason": "OPEN_ASSIGNMENT_EXISTS" } ] }
```

- **Errors:**
  - 400;
  - 401;
  - 403 (Employee, or the employee or team is not the manager's);
  - 404 (unknown training, employee or team);
  - 409 (single employee who already has an **open** assignment of that training).

### 4.10 `GET /api/assignments/me`

- **Roles:** Employee, Manager (their own assignments).
- **200:** `[Assignment]` with calculated `status` and `daysOverdue`. Open assignments come first, ordered by `dueDate`.
- **Errors:** 401.

### 4.11 `PATCH /api/assignments/{id}/complete`

- **Roles:** the assignment's **own employee only**. A manager cannot complete it for them.
- **Body:** none.
- **Effect:**
  - Sets `completedAt = now`.
  - **Renewal:** if the training has `validityMonths`, a new assignment is created. It is due on `completedAt (UTC date) + validityMonths`, with `renewalOfId` set to the completed one.
- **200:**

```json
{ "completed": { "...Assignment, status Completed...": "" }, "renewal": { "...Assignment, status Assigned...": "" } }
```

`renewal` is `null` when the training never expires.

- **Errors:** 400, 401, 403 (not your assignment), 404, 409 (already completed).

### 4.12 `GET /health`

No auth. Returns `200 {"status":"ok","service":"employee-training"}`.

---

## 5. S2 Certificate & Compliance (port 5002)

**Owner: Karim. Tables:** `certificates`, `compliance_flags`, `audit_log`. Files go to the private S3 bucket `certificates`. Calls S1 (section 7) and SendGrid, the external API.

### 5.1 `POST /api/certificates`

- **Roles:** Employee, Manager (uploading **their own** certificate).
- **Body:** `multipart/form-data`.
  - **Fields:** `file`, `trainingId`, `title`, `issuer`, `certificateNumber` (optional), `issueDate`, `expiryDate`.
  - `employeeId` comes from the token, never from the form.
- **Validation:**
  - **File type:** checked by **magic bytes**: `%PDF` (25 50 44 46), JPEG (FF D8 FF) or PNG (89 50 4E 47). The extension and `Content-Type` are ignored. Anything else returns **415**.
  - **File size:** at most 5 MB, otherwise **413**.
  - **Dates:** both must be valid, and `issueDate <= expiryDate`, otherwise 400.
  - **Training:** `trainingId` must exist (S1 `GET /api/trainings/{id}`), otherwise 404.
- **Effect:**
  - The file is stored under a random UUID key.
  - S2 keeps the SHA-256 hash, MIME type and size.
  - `reviewStatus = Pending`.
  - An audit row is written.
- **201:** `Certificate`.
- **Errors:** 400, 401, 404, 413, 415.

### 5.2 `GET /api/certificates/me`

- **Roles:** Employee, Manager.
- **200:** `[Certificate]` (not deleted), with calculated `validity`.
- **Errors:** 401.

### 5.3 `GET /api/certificates?teamId=&reviewStatus=`

The team list and verify queue.

- **Roles:** the manager of `teamId`.
- **Query:** `teamId` is required. `reviewStatus` is optional: `Pending`, `Verified` or `Rejected`.
- **200:** `[Certificate]`.
- **Errors:** 400, 401, 403, 404.

### 5.4 `GET /api/certificates/{id}`

- **Roles:** the owner; the manager of the owner's team.
- **200:** `Certificate`.
- **Errors:** 400, 401, 403, 404.

### 5.5 `PUT /api/certificates/{id}`

- **Roles:** the owner, **only while Pending**.
- **Body:** `title`, `issuer`, `certificateNumber`, `issueDate`, `expiryDate`. The file cannot be replaced: upload a new certificate instead.
- **200:** `Certificate`.
- **Errors:** 400, 401, 403, 404, 409 (not Pending any more).

### 5.6 `GET /api/certificates/{id}/download`

- **Roles:** the owner; the manager of the owner's team.
- **200:**

```json
{ "url": "https://...presigned...", "expiresInSeconds": 300 }
```

  The pre-signed URL is valid for 5 minutes and uses `Content-Disposition: attachment`. The download is audit-logged.
- **Errors:** 400, 401, 403, 404.

### 5.7 `PATCH /api/certificates/{id}/verify`

- **Roles:** the manager of the owner's team, **never for their own certificate**.
- **Body:**

```json
{ "decision": "verify", "reason": null }
```

or

```json
{ "decision": "reject", "reason": "The scan is unreadable" }
```

  `reason` is required for `reject`, 1–500 chars.
- **Rule:** only a **Pending** certificate can be decided.
- **200:** `Certificate`.
- **Errors:** 400, 401, 403, 404, 409.

### 5.8 `DELETE /api/certificates/{id}`

- **Roles:** the owner while Pending, or the manager of the owner's team.
- **Effect:** soft delete (`deleted_at`), audit-logged.
- **204:** no body.
- **Errors:** 400, 401, 403, 404.

### 5.9 `GET /api/compliance/teams/{teamId}`

- **Roles:** the manager of `teamId`; Service.
- **200:**

```json
{ "teamId": "10000000-0000-4000-8000-000000000001",
  "employees": [ {
    "employeeId": "20000000-0000-4000-8000-000000000004",
    "certificates": [ { "certificateId": "50000000-0000-4000-8000-000000000002", "trainingId": "30000000-0000-4000-8000-000000000005",
                        "reviewStatus": "Verified", "expiryDate": "2026-12-02", "validity": "Expiring soon" } ],
    "flags": [ { "flagType": "Missing", "trainingId": "30000000-0000-4000-8000-000000000002", "certificateId": null,
                 "raisedAt": "2026-11-22T01:00:00.000Z" } ] } ] }
```

- **Missing / Expired logic:**
  1. Ask S1 for `GET /api/teams/{teamId}/assignments?status=completed`.
  2. Keep the assignments with `requiresCertificate = true`.
  3. For each one, look for a Verified, unexpired certificate for that training.
- **Errors:** 400, 401, 403, 404, 502/503.

### 5.10 `POST /api/compliance/run-check`

The daily job.

- **Roles:** **Service only.** Employees and Managers get 403.
- **Effect:**
  - Re-evaluates validity.
  - Creates and resolves ComplianceFlag rows.
  - Sends SendGrid reminders at 30 days, 7 days and on the expiry day. Each reminder is sent once (`notified_at`).
- **200:**

```json
{ "flagsRaised": 2, "flagsResolved": 1, "remindersSent": 1, "remindersSkipped": 0 }
```

- **Errors:** 401, 403.

### 5.11 `GET /health`

No auth.

---

## 6. S3 Manager Dashboard & Reports (port 5003)

**Owner: Yahia. Tables:** `compliance_snapshots`, `report_runs`. S3 holds no training or certificate data: it calls S1 and S2.

Unless noted, every endpoint is **Manager only**:
- **401:** no token;
- **403:** not a manager, or not the manager of `{teamId}`;
- **404:** unknown team;
- **502/503:** S1 or S2 failed or timed out.

### 6.1 `GET /api/dashboard/teams/{teamId}/summary`

```json
{ "teamId": "10000000-0000-4000-8000-000000000001", "teamName": "Operations",
  "employeeCount": 4, "compliantCount": 2, "nonCompliantCount": 2, "complianceRate": 50.0,
  "nonCompliantByReason": { "OverdueTraining": 1, "CertificateMissing": 1, "CertificateExpired": 0 },
  "overdueTrainings": 1, "expiringWithin30Days": 1, "generatedAt": "2026-11-22T12:00:00.000Z" }
```

`complianceRate` = compliant / all employees × 100, rounded to 1 decimal. It is `0` for an empty team.

### 6.2 `GET /api/dashboard/teams/{teamId}/employees?status=`

- **Query:** `status` is optional: `compliant` or `non-compliant`. Anything else returns 400.
- **200:** `[ComplianceRow]`.

### 6.3 `GET /api/dashboard/teams/{teamId}/attention`

- **200:** `[ComplianceRow]`, ranked:
  1. Non-compliant first, longest overdue or expired first.
  2. Then "Expiring soon", soonest first.

### 6.4 `GET /api/dashboard/teams/{teamId}/trend?days=30`

- **Query:** `days` is an integer 1–90 (default 30). Above 90 returns 400.
- **200:**

```json
{ "teamId": "10000000-0000-4000-8000-000000000001", "days": 30,
  "points": [ { "date": "2026-11-21", "complianceRate": 50.0, "employeeCount": 4 } ] }
```

### 6.5 `POST /api/dashboard/run-snapshot`

The daily job.

- **Roles:** **Service only.** Others get 403.
- **Effect:** upserts one `compliance_snapshots` row per employee per day. Running it twice on the same day keeps one row.
- **200:**

```json
{ "snapshotDate": "2026-11-22", "teamsProcessed": 2, "rowsUpserted": 8 }
```

- **Errors:** 401, 403, 502/503.

### 6.6 `GET /api/reports/teams/{teamId}?category=`

Writes one `report_runs` row.

- **200:**

```json
{ "reportRunId": "...", "teamId": "...", "category": "Safety", "generatedAt": "...",
  "rows": [ { "employeeId": "...", "name": "Ahmed Ali", "trainingName": "Fire Safety", "category": "Safety",
              "assignmentStatus": "Overdue", "dueDate": "2026-11-12", "certificateStatus": "Missing", "compliance": "Non-compliant" } ] }
```

- **Errors:** 400 (category longer than 50 chars), 401, 403, 404.

### 6.7 `GET /api/reports/teams/{teamId}/export?category=`

- **200:** the same rows as 6.6 as CSV.
  - `Content-Type: text/csv; charset=utf-8`
  - `Content-Disposition: attachment; filename="team-report.csv"`
- **CSV injection guard:** cells starting with `=`, `+`, `-` or `@` are prefixed with `'`.

### 6.8 `GET /api/reports/history`

- **200:** `[{ "id", "teamId", "category", "generatedBy", "generatedAt", "rowCount" }]` for the caller's teams.

### 6.9 `DELETE /api/reports/history/{id}`

- **204:** no body.
- **Errors:** 400, 401, 403, 404.

### 6.10 `GET /health`

No auth.

---

## 7. Service-to-service calls

All calls go over HTTP inside the Docker network, with a timeout of **3 seconds**, and forward `X-Request-Id`.

- **Interactive requests** forward the **caller's own token**, so S1 applies the same ownership rules.
- **Scheduled jobs** use the **Service token**.

| Caller | Calls | Why |
|---|---|---|
| S2 | S1 `GET /api/employees/me` | the uploader's `employeeId` |
| S2 | S1 `GET /api/trainings/{id}` | the training exists before an upload |
| S2 | S1 `GET /api/employees/{id}` | owner's team, for "manager of the owner's team" checks |
| S2 | S1 `GET /api/teams`, `GET /api/teams/{teamId}/employees` | team ownership and the team list |
| S2 | S1 `GET /api/teams/{teamId}/assignments?status=completed` | Missing / Expired flags |
| S3 | S1 `GET /api/teams`, `/api/teams/{teamId}/employees`, `/api/teams/{teamId}/assignments` | ownership, team members, Overdue |
| S3 | S2 `GET /api/compliance/teams/{teamId}` | certificate validity and flags |

S1 calls nobody. **No service reads another service's tables.**

---

## 8. Business rules (reference)

| Rule | Exact definition | Owner |
|---|---|---|
| Overdue | `dueDate < today (UTC)` **and** `completedAt` is null. Due **today** is NOT overdue. | S1 |
| Status | `Completed` if `completedAt` is set (even if late), otherwise `Overdue` per above, otherwise `Assigned`. Calculated on read, never stored. | S1 |
| Renewal | Completing an assignment whose training has `validityMonths` creates the next assignment, due `completedAt + validityMonths`. If that day doesn't exist, it moves to the month's last day: Jan 31 + 1 month = Feb 28/29. | S1 |
| One open assignment | A second **open** assignment of the same training for the same employee returns 409. This is also enforced by a database index. | S1 |
| Certificate validity | Valid: the expiry is **more than 30 days** away. Expiring soon: it expires in **0–30 days**. Expired: the expiry date has passed. | S2 |
| Counts for compliance | Only **Verified** certificates. Pending and Rejected never make anyone compliant. | S2 |
| Flags | For every **completed** training with `requiresCertificate`: no Verified, unexpired certificate gives `Missing`. If the newest Verified certificate has expired, the flag is `Expired`. | S2 |
| Compliant | No Overdue assignment **and** no open Missing or Expired flag. Otherwise Non-compliant, with reasons `OverdueTraining`, `CertificateMissing` and `CertificateExpired`. "Expiring soon" stays Compliant, but goes on the attention list. | S3 |
| Compliance rate | compliant / all employees × 100, for the whole team or one category, rounded to 1 decimal. An empty team gives 0. | S3 |
