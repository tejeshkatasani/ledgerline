# LedgerLine — My Threat Model

## 1. Why I created this document

While building LedgerLine, I wanted to think beyond normal application functionality. Since this application handles financial transactions, I considered what could go wrong if someone tried to misuse the API, access another user's account, manipulate transactions, or tamper with records.

I used the STRIDE methodology to identify possible security threats and document the controls I implemented or planned.

My main focus areas are authentication, authorization, transaction integrity, audit logging, data validation, and availability.

## 2. Application trust boundaries

The main components of my application are:

- Client: Sends registration, login, account and transfer requests.
- Express API: Handles authentication, validation and business logic.
- PostgreSQL: Stores users, accounts, transactions and audit records.
- JWT middleware: Verifies authenticated requests.
- Ownership checks: Ensure users can access only their permitted resources.

I treat every request coming from the client as untrusted.

## 3. Threats I identified

### T1 — Duplicate payments

**STRIDE category:** Tampering

**What could happen?**

A user may submit the same transfer request multiple times because of repeated clicks, network retries or malicious requests. This could result in money being transferred more than once.

**How I addressed it:**

- Implemented an Idempotency-Key mechanism for transfers.
- Scoped idempotency records using the key, authenticated user and request path.
- Added database uniqueness protection.
- Checked whether a key is being reused for a different transfer.

**Testing:** `tests/transfers.test.ts`

I test duplicate requests and reuse of the same key with different account details.

**Remaining consideration:** I need to ensure missing idempotency keys are handled consistently on every sensitive transaction endpoint.

### T2 — Unauthorized transfers

**STRIDE category:** Elevation of privilege / Spoofing

**What could happen?**

A logged-in user could attempt to transfer money from an account belonging to another user by changing the source account ID.

**How I addressed it:**

- Protected routes using JWT authentication.
- Added account ownership validation.
- Performed ownership checks inside the transfer transaction.
- Used database row locking before processing the transfer.

**Testing:** `tests/transfers.test.ts`

I test that a user cannot transfer funds from another user's account.

**Remaining risk:** If JWT signing credentials are compromised, an attacker may be able to impersonate users. Secret protection and rotation are important.

### T3 — Audit log tampering

**STRIDE category:** Tampering / Repudiation

**What could happen?**

Someone with database access could attempt to modify or delete audit records to hide a transaction or change its history.

**How I addressed it:**

- Added database-level protection against updating and deleting audit records.
- Implemented an HMAC-SHA256 hash-chain approach.
- Linked each audit record to the previous record through `prev_hash`.
- Added an audit verification endpoint.

**Testing:** `tests/audit.test.ts`

I test database mutation protection and audit-chain verification behavior.

**Known issue:**

During local verification, the endpoint returned:

`valid: false, firstBadId: 7`

I have documented this as an unresolved issue. I will not consider the audit-chain integrity feature fully verified until I identify the cause, fix it without deleting historical records, and pass the verification tests.

### T4 — Negative balance and concurrent transfers

**STRIDE category:** Tampering

**What could happen?**

Two transfer requests could execute at nearly the same time. Both might read the same available balance and attempt to spend the same funds.

**How I addressed it:**

- Used SERIALIZABLE transaction isolation.
- Used row-level locking with `FOR UPDATE`.
- Locked accounts in a consistent order.
- Added database-level balance constraints.

**Testing:** `tests/transfers.test.ts`

I have tested insufficient-funds rejection. Concurrent transfer behavior must also be verified with explicit simultaneous-request tests.

### T5 — Account enumeration and IDOR

**STRIDE category:** Information Disclosure / Elevation of privilege

**What could happen?**

A user could change an account UUID or transaction ID in an API request to access another user's financial information.

**How I addressed it:**

- Added ownership checks to protected account and transaction operations.
- Used UUIDs for resource identifiers.
- Avoided relying on unpredictable IDs as a replacement for authorization.

**Testing:** I need to ensure cross-user access is explicitly tested for account details, balances and transaction history, not just transfers.

### T6 — Login brute force and credential stuffing

**STRIDE category:** Spoofing

**What could happen?**

An attacker could repeatedly submit passwords or use leaked credentials to gain access to user accounts.

**How I addressed it:**

- Used bcrypt password hashing.
- Configured rate limiting for general API routes and authentication routes.
- Used consistent authentication error responses for unknown users and incorrect passwords.

**Testing:** `tests/auth.test.ts`

I test that an unknown email and an incorrect password return the same authentication error.

**Remaining consideration:** Account lockout, MFA and monitoring can provide additional protection.

### T7 — Secret exposure

**STRIDE category:** Spoofing / Elevation of privilege

**What could happen?**

If JWT or audit HMAC secrets are exposed, attackers may forge authentication tokens or compromise audit verification.

**How I addressed it:**

- Kept `.env` out of Git.
- Added `.env.example` with placeholder values.
- Used environment variables for sensitive configuration.
- Added startup checks for required secrets.

I also checked the files before pushing the project to GitHub to avoid committing my local `.env` file.

**Remaining consideration:** Production secrets must remain in Render environment settings and should be rotated if exposure is suspected.

### T8 — Mass assignment and over-posting

**STRIDE category:** Tampering

**What could happen?**

A user could send extra fields such as `balance`, `user_id` or administrative properties in a request body to manipulate server-side data.

**How I addressed it:**

- Used Zod validation schemas.
- Defined accepted request fields.
- Calculated financial values on the server instead of trusting client-provided balances.

**Remaining consideration:** I need explicit negative tests for unexpected fields on every mutation endpoint.

### T9 — Denial of service through large requests

**STRIDE category:** Denial of Service

**What could happen?**

An attacker could send very large request bodies or repeatedly call endpoints to consume server resources.

**How I addressed it:**

- Restricted JSON request body size.
- Added rate limiting.
- Validated incoming request data.

**Remaining consideration:** I can strengthen this further with distributed rate limiting, request timeouts and monitoring.

### T10 — SQL injection

**STRIDE category:** Tampering / Information Disclosure

**What could happen?**

An attacker could insert SQL commands into input fields to access or modify database information.

**How I addressed it:**

- Used parameterized PostgreSQL queries.
- Avoided directly concatenating user input into SQL statements.
- Validated request inputs before database operations.

**Remaining consideration:** I will continue reviewing database queries whenever new endpoints are introduced.

## 4. Known limitations and future improvements

I understand that having security controls in code does not automatically prove that every attack is prevented.

These are the areas I still want to improve:
## 4. Known limitations and future improvements

While developing LedgerLine, I identified a few areas that still need improvement. I have documented them instead of claiming that every security feature is fully verified.

### 1. Audit Chain Integrity
- **Current status:** Audit verification returned `valid: false`, `firstBadId: 7`.
- **Problem:** The audit hash-chain verification is not passing.
- **My next step:** Investigate JSON/JSONB canonicalization, HMAC consistency and historical record verification.
- **Priority:** Critical.

### 2. Database Permissions
- **Current status:** Application and audit database permissions need further separation.
- **Problem:** Database access should follow the principle of least privilege.
- **My next step:** Introduce separate database roles with restricted permissions.
- **Priority:** High.

### 3. Rate Limiting
- **Current status:** Current rate limiting is not distributed across multiple application instances.
- **Problem:** In-memory rate limits may not provide consistent protection across instances.
- **My next step:** Evaluate Redis-backed rate limiting.
- **Priority:** Medium.

### 4. Authentication
- **Current status:** Multi-factor authentication is not implemented.
- **Problem:** Password-based authentication alone has limitations.
- **My next step:** Consider implementing TOTP-based MFA.
- **Priority:** Medium.

### 5. JWT Security
- **Current status:** Token expiry and rotation require further hardening.
- **Problem:** Compromised or long-lived tokens can increase security risks.
- **My next step:** Evaluate refresh-token rotation and improved token lifecycle management.
- **Priority:** High.

### 6. Authorization Testing
- **Current status:** More cross-user access tests are required.
- **Problem:** Every resource endpoint must prevent unauthorized access.
- **My next step:** Add negative tests for account details, balances and transaction history.
- **Priority:** Critical.

### 7. Concurrent Transfers
- **Current status:** More simultaneous-transfer tests are needed.
- **Problem:** Concurrent requests must never result in incorrect balances or duplicate transactions.
- **My next step:** Add concurrency stress tests and verify transaction isolation behavior.
- **Priority:** Critical.

## 5. My approach to security

I did not treat security as a final step after building the UI. I considered it while designing authentication, account ownership, transfer processing and audit logging.

I also used automated tests to check important failure scenarios instead of testing only successful requests.

My next priority is to resolve the audit integrity verification issue and strengthen negative security tests before treating LedgerLine as production-ready.
## 5. My approach to security

I did not treat security as a final step after building the UI. I considered it while designing the authentication, account ownership, transfer and audit flows.

I also used automated tests to check important failure scenarios, rather than testing only successful requests.

My next priority is to resolve the audit integrity verification issue and strengthen the negative security tests before treating LedgerLine as production-ready.