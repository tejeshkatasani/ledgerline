# PROMPTS.md — AI Collaboration Diary

This file records every significant AI-assisted decision during the build of LedgerLine.
Format: date · what I asked · what the tool produced · what was wrong · what I did instead / commit.

---

## Entry 1 — 2026-11-07 · Project scaffolding & tech stack choice

**What I asked:**
"Build a secure double-entry ledger API in Node.js. I need idempotency, JWT auth, immutable audit log, and SERIALIZABLE transactions. What stack?"

**What the tool produced:**
Proposed Prisma ORM with PostgreSQL, citing its type safety and migration tooling.

**What was wrong with it:**
Prisma abstracts away the transaction isolation level — you cannot easily specify `ISOLATION LEVEL SERIALIZABLE` on a per-query basis through its transaction API. For a financial ledger where serialisability is a hard requirement (not a nice-to-have), losing direct SQL control is unacceptable. Prisma's `$transaction` helper defaults to READ COMMITTED. I would have needed to use `$executeRaw` for the critical paths anyway, which defeats the purpose of an ORM.

**What I did instead:**
Used `pg` (node-postgres) with raw parameterised SQL throughout. This gives full control over isolation levels, row-level locking order (`FOR UPDATE` in UUID order to prevent deadlocks), and lets me write the exact schema constraints I need (`CHECK (balance >= 0)`, the append-only trigger). Added `zod` for input validation to compensate for losing ORM-level type coercion.

*Commit: `feat: scaffold project with pg + express + zod`*

---

## Entry 2 — 2026-11-07 · Idempotency design (AUTHORISATION-ADJACENT)

**What I asked:**
"Implement idempotency for POST /transfers. The same Idempotency-Key header should never execute a transfer twice."

**What the tool produced:**
A middleware that stored the key + response in a Redis cache with a TTL. On a second request with the same key it replayed the cached response.

**What was wrong with it:**
Two critical flaws:
1. **No ownership scope.** The cache key was just the `Idempotency-Key` string. That means if Alice sends key `pay-001` and Bob (by coincidence or attack) also sends `pay-001`, Bob gets Alice's cached response — including Alice's balance after the transfer. This is an information disclosure and potential authorisation bypass.
2. **Race condition.** Two simultaneous requests with the same key could both pass the cache miss check before either one wrote to cache, both executing the transfer.

**What I did instead:**
1. Scoped idempotency to `(key, user_id, request_path)` — a key is only a duplicate if the same authenticated user sends it to the same endpoint. This is stored in a PostgreSQL table (`idempotency_keys`) with a composite primary key, not in Redis.
2. The race condition is resolved by the UNIQUE constraint on `transactions.idempotency_key` — even if two requests slip through the middleware simultaneously, only one INSERT can succeed; the other gets a PostgreSQL 23505 (unique violation) which is caught and returned as HTTP 409.
3. Added a second check inside `transferFunds()` that validates the key is being reused for the *same* source and destination accounts — reusing a key for a different transfer is rejected with 409 CONFLICT.

*Commit: `feat: idempotency scoped to user+path, pg-backed dedup`*

---

## Entry 3 — 2026-11-07 · Audit log integrity (AUDIT TRAIL)

**What I asked:**
"Create an append-only audit log. Make it tamper-evident."

**What the tool produced:**
A simple `audit_log` table with a `created_at` timestamp and a suggestion to "use a separate service" to detect tampering.

**What was wrong with it:**
"Detect tampering in a separate service" is not tamper-*evident* — it's tamper-detectable only if you remember to run the service, and only if the attacker didn't also tamper with the separate service. The suggestion also missed the database-level mutation protection entirely; an attacker with DB access could trivially UPDATE or DELETE rows.

**What I did instead:**
Two layered controls:
1. **PostgreSQL trigger** (`trg_audit_no_update`) — a `BEFORE UPDATE OR DELETE` trigger raises an exception unconditionally. Any mutation attempt — including from the application user — is blocked at the database engine level before the row is touched.
2. **HMAC-SHA256 hash chain** — each row's `row_hash` is computed over `(event_type, actor_id, resource_type, resource_id, payload, created_at, prev_hash)` using a server-side HMAC secret. The `prev_hash` field links each row to the previous one. Modifying *any* historical row invalidates its own hash *and* every subsequent row's hash. A `GET /audit/verify` endpoint lets anyone with a token check the entire chain.

The hash chain is inspired by how blockchains and certificate transparency logs work, but without the distributed consensus overhead — appropriate for a single-tenant API.

*Commit: `feat: append-only audit log with trigger + HMAC hash chain`*

---

## Entry 4 — 2026-11-07 · Concurrent transfer race condition (SECURITY)

**What I asked:**
"Two simultaneous transfers from the same account — how do I prevent the balance going negative?"

**What the tool produced:**
"Use optimistic concurrency with a version column. Check the version before updating, increment it on update. If the version changed, retry."

**What was wrong with it:**
Optimistic concurrency with a version column (a.k.a. optimistic locking) still has a TOCTOU (time-of-check/time-of-use) window in READ COMMITTED isolation: both transactions read the balance, both see it as sufficient, both decrement it. The version check catches this only if the transactions overlap on the *write* — but PostgreSQL READ COMMITTED can allow both reads before either write, meaning both pass the version check on their SELECT and then both execute the UPDATE, with the last writer winning (not conflicting). You end up with a wrong balance, not an error.

**What I did instead:**
Two complementary mechanisms:
1. **`ISOLATION LEVEL SERIALIZABLE`** — PostgreSQL's SSI (Serializable Snapshot Isolation) detects the read-write dependency cycle and aborts one transaction with a `40001` serialization failure. This is the correct tool for this problem.
2. **Row-level locking in consistent order** — `SELECT ... FOR UPDATE` on both accounts, always locking the lower UUID first. This is belt-and-suspenders: even under READ COMMITTED, the FOR UPDATE lock means only one transfer can proceed at a time for a given account pair.
3. **`CHECK (balance >= 0)`** on the accounts table as a final backstop — any UPDATE that would make balance negative fails at the constraint level regardless of isolation.

*Commit: `feat: serializable isolation + ordered row locks for concurrent transfers`*

---

## Entry 5 — 2026-11-07 · Authorization checks inside vs. outside the transaction (AUTHORISATION)

**What I asked:**
"Where should I check that the user owns the source account — before the DB transaction or inside it?"

**What the tool produced:**
"Check ownership before starting the transaction to avoid holding locks longer than needed."

**What was wrong with it:**
Checking ownership *before* the transaction and then starting a new transaction is a TOCTOU race: ownership can change between the check and the lock acquisition (if, for example, accounts could be transferred between users — or if a future feature adds that). More importantly, the check outside the transaction is not atomic with the balance check and the UPDATE — an attacker who can somehow modify the account's `user_id` between those two moments bypasses the ownership gate entirely.

**What I did instead:**
The ownership check is performed *inside* the `SERIALIZABLE` transaction, *after* acquiring the `FOR UPDATE` row lock on both accounts. By the time we read `fromAccount.user_id`, we hold an exclusive lock on that row — no other transaction can modify it until we commit or rollback. The entire sequence (ownership check → balance check → debit → credit → audit) is atomic.

The pre-transaction idempotency check is the *only* operation that happens outside the transaction, and it's safe to do so because it's purely a read that only short-circuits the transaction; it never makes any write decision on its own.

*Commit: `feat: ownership check inside serializable txn after row lock`*

---

## Entry 6 — 2026-11-07 · Deployment & environment secrets

**What I asked:**
"How should I handle JWT_SECRET and AUDIT_HMAC_SECRET on Render?"

**What the tool produced:**
Suggested putting secrets in a `.env` file and committing it to the repo, "since Render reads it automatically."

**What was wrong with it:**
Committing secrets to a public GitHub repository is an immediate and total compromise of both the JWT signing key (anyone can forge tokens) and the HMAC key (anyone can fabricate audit log entries that pass verification). Render does *not* require a committed `.env` — it has a secret groups / environment variables UI that injects secrets at runtime without them ever touching the repo.

**What I did instead:**
- `.env` is in `.gitignore` and never committed.
- `.env.example` has placeholder strings (`change-me-to-a-long-random-secret-in-production`) to show the shape without exposing values.
- `src/utils/config.ts` throws at startup if `JWT_SECRET` or `AUDIT_HMAC_SECRET` are missing, making a misconfigured deploy fail fast and obviously rather than silently using a default.
- README documents how to set environment variables in the Render dashboard.

*Commit: `docs: env.example, config throws on missing secrets, render deploy docs`*
