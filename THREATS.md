# THREATS.md — LedgerLine Threat Model

## Methodology

STRIDE-based analysis (Spoofing, Tampering, Repudiation, Information Disclosure, Denial of Service, Elevation of Privilege) applied to every trust boundary in LedgerLine.

---

## Trust Boundaries

```
[Client]  ──HTTPS──►  [Express API]  ──TCP──►  [PostgreSQL]
                           │
                       [JWT validation]
                       [Ownership checks]
                       [Rate limiter]
```

---

## Threat Catalogue

### T1 — Duplicate Payment (STRIDE: T)

**Description:** An attacker (or network fault) replays a POST /transfers request, causing the same funds to be moved twice.

**Impact:** Financial loss for the sender; books no longer balance.

**Controls:**
- `Idempotency-Key` header required on transfers. Stored in `idempotency_keys` table keyed on (key, user_id, path).
- Duplicate key detection happens inside a SERIALIZABLE transaction — no window for a race condition.
- Database UNIQUE constraint on `transactions.idempotency_key` as a last-resort backstop.

**Tests:** `tests/transfers.test.ts` — "idempotency — identical key does not double-spend", "rejects same key reused for different accounts".

**Residual risk:** Client may fail to include the key. Mitigation: document it as required; consider rejecting requests without a key on sensitive endpoints.

---

### T2 — Unauthorised Transfer (STRIDE: E/S)

**Description:** User B sends a POST /transfers using User A's `from_account_id` to drain A's account.

**Impact:** Theft of funds.

**Controls:**
- `requireAuth` middleware validates JWT on every protected route.
- `ledgerService.transferFunds` explicitly checks `fromAccount.user_id === initiatedBy` inside the SERIALIZABLE transaction, after row-level locking.
- Returns 403 Forbidden — does not leak whether the account exists.

**Tests:** `tests/transfers.test.ts` — "REQ9: forbids transfer from account user does not own".

**Residual risk:** JWT secret compromise. Mitigation: rotate JWT secret; short expiry (24h).

---

### T3 — Audit Log Tampering (STRIDE: T/R)

**Description:** An attacker with DB access modifies or deletes audit_log rows to cover their tracks.

**Impact:** Loss of non-repudiation; legal/compliance failure.

**Controls:**
1. PostgreSQL trigger `trg_audit_no_update` raises an exception on any UPDATE or DELETE — enforced at the database layer regardless of application behaviour.
2. HMAC-SHA256 hash chain: each row's `row_hash` covers (event_type, actor_id, resource_type, resource_id, payload, created_at, prev_hash). Modifying any field of any row breaks all subsequent hashes.
3. `GET /audit/verify` endpoint lets anyone with a token check the full chain at any time.

**Tests:** `tests/audit.test.ts` — "blocks UPDATE on audit_log rows", "blocks DELETE on audit_log rows", "chain verification detects tampered row_hash".

**Residual risk:** Superuser (`postgres` role) can disable triggers. Mitigation: revoke superuser from the app role; use a separate audit DB user with INSERT-only privileges.

---

### T4 — Negative Balance Exploit (STRIDE: T)

**Description:** An attacker sends two large simultaneous transfers that individually check the balance as sufficient but together overdraw the account.

**Impact:** Account goes negative; books don't balance.

**Controls:**
1. `ISOLATION LEVEL SERIALIZABLE` — PostgreSQL detects the read-write conflict and raises a serialization_failure (40001), which is returned as HTTP 409 for the client to retry.
2. `CHECK (balance >= 0)` constraint on `accounts.balance` — a database-level backstop that prevents any UPDATE that would make balance negative from committing.
3. Accounts are row-locked (`FOR UPDATE`) in a consistent order (lower UUID first) before any read, preventing deadlocks.

**Tests:** The CHECK constraint is exercised by every transfer test that expects a balance to remain non-negative.

**Residual risk:** Serialization retries under extreme contention. Mitigation: client-side exponential back-off; per-account queue in a high-throughput future version.

---

### T5 — Account Enumeration / IDOR (STRIDE: I/E)

**Description:** An attacker guesses or brute-forces account UUIDs to read balances or transaction history belonging to other users.

**Impact:** Information disclosure; potential targeted attacks.

**Controls:**
- All account/transaction routes check `user_id` ownership before returning data.
- UUIDs (v4) are cryptographically random — 122 bits of entropy makes enumeration infeasible.
- 404 vs 403 responses are normalised: if a resource doesn't belong to the caller, return 403 (not 404) to avoid leaking existence.

**Note:** Current implementation returns 403 when the account exists but isn't owned. A stricter hardening would return 404 consistently. Tracked as a known trade-off.

---

### T6 — Credential Stuffing / Brute Force (STRIDE: S)

**Description:** Automated tools try large numbers of email/password combinations against POST /auth/login.

**Impact:** Account takeover.

**Controls:**
- `express-rate-limit` on all routes (100 req/15 min).
- Stricter rate limit on `/auth` routes (20 req/15 min).
- `bcrypt` with cost factor 12 makes each hash attempt ~300ms — renders large-scale brute force impractical.
- Constant-time response for unknown email (dummy hash always compared) prevents user enumeration via timing.

**Tests:** `tests/auth.test.ts` — "returns 401 for unknown email (same error as wrong password)".

---

### T7 — JWT Secret Exposure (STRIDE: S/E)

**Description:** The `JWT_SECRET` or `AUDIT_HMAC_SECRET` is committed to source control or leaked via logs.

**Impact:** Attacker can forge tokens or silently tamper with audit rows.

**Controls:**
- Both secrets loaded from environment variables; `.env` is in `.gitignore`.
- `.env.example` contains placeholder values, not real secrets.
- Application throws at startup if either required env var is missing.

**Residual risk:** Env vars logged by deployment platform. Mitigation: use secret management (e.g., Render secret groups).

---

### T8 — Mass Assignment / Over-Posting (STRIDE: T)

**Description:** Client sends extra fields (e.g., `balance`, `user_id`) in request body to manipulate server-side data.

**Impact:** Unauthorised data modification.

**Controls:**
- Zod schemas on every mutation endpoint declare the exact allowed shape; any extra field is stripped or rejected.
- Balance is never accepted from the client for transfers — it is always computed by the server from the current DB state.

---

### T9 — Denial of Service via Large Payloads (STRIDE: D)

**Description:** Attacker sends very large JSON bodies to exhaust memory or slow the server.

**Impact:** Service unavailability.

**Controls:**
- `express.json({ limit: '10kb' })` — requests exceeding 10 KB are rejected with 413.
- Rate limiting further throttles abusive clients.

---

### T10 — SQL Injection (STRIDE: T/I)

**Description:** Attacker embeds SQL in request parameters to read or modify arbitrary data.

**Impact:** Full database compromise.

**Controls:**
- All queries use parameterised statements (`$1`, `$2`, …) via the `pg` library — no string concatenation of user input into SQL.
- Zod input validation rejects malformed input before it reaches the database layer.

---

## Known Limitations / Future Hardening

| Item | Risk | Mitigation Plan |
|---|---|---|
| Single DB role | Admin role = app role | Separate read/write/audit roles |
| No refresh tokens | Token theft = 24h window | Add short-lived access + refresh token rotation |
| In-memory rate limiter | Doesn't persist across restarts | Redis-backed rate limiter |
| No MFA | Credential theft sufficient for takeover | TOTP second factor |
| Audit DB user | App can INSERT into audit_log | Separate audit-writer role with INSERT-only |
