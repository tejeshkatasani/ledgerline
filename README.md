# LedgerLine

Money movement with a ledger you can prove.

LedgerLine includes a browser dashboard served by the Express application and a JSON API behind the same origin.

**Live URL:** https://ledgerline-mbwz.onrender.com  
**GitHub:** https://github.com/tejeshkatasani/ledgerline

---

## What it does

LedgerLine is a financial workspace with a browser UI and REST API for moving money between accounts where every transaction is:

- **Accurate** — double-entry bookkeeping; every debit has an equal credit
- **Atomic** — SERIALIZABLE PostgreSQL transactions; partial transfers are impossible
- **Idempotent** — same `Idempotency-Key` header never pays twice
- **Authorised** — JWT authentication; you can only move money from accounts you own
- **Traceable** — an append-only, HMAC-chained audit log that detects tampering

---

## Browser application

Open the root URL (`/`) to use the LedgerLine dashboard. The UI includes:

- Sign in and account registration
- Overview of active accounts and recent transactions
- Create and close accounts
- Initiate transfers using a destination account UUID
- Review transaction history
- View audit events and verify the audit chain

The browser app is served from `public/` by Express. It uses the same origin as the API, so no separate frontend deployment or CORS configuration is required.

## API Reference

All routes except `/health`, `POST /auth/register`, and `POST /auth/login` require:

```
Authorization: Bearer <jwt>
```

### Auth

| Method | Path | Body | Description |
|--------|------|------|-------------|
| POST | `/auth/register` | `{ email, password }` | Create account, returns JWT |
| POST | `/auth/login` | `{ email, password }` | Login, returns JWT |

### Accounts

| Method | Path | Description |
|--------|------|-------------|
| GET | `/accounts` | List caller's accounts |
| POST | `/accounts` | Create account (`name`, `currency`, `initialBalance`) |
| GET | `/accounts/:id` | Get single account (must own) |
| DELETE | `/accounts/:id` | Close account (balance must be zero) |

### Transfers

| Method | Path | Body | Description |
|--------|------|------|-------------|
| POST | `/transfers` | `{ from_account_id, to_account_id, amount, currency }` | Transfer funds |

Include `Idempotency-Key: <uuid>` header to make the transfer idempotent.

### Transactions

| Method | Path | Description |
|--------|------|-------------|
| GET | `/transactions` | List transactions involving caller |
| GET | `/transactions/:id` | Get transaction + ledger entries |
| GET | `/transactions/account/:id/ledger` | Paginated ledger for an account |

### Audit

| Method | Path | Description |
|--------|------|-------------|
| GET | `/audit` | Caller's audit events |
| GET | `/audit/verify` | Verify integrity of the full audit chain |

---

## Running Locally

### Prerequisites

- Node.js 18+
- PostgreSQL 14+

### Setup

```bash
git clone https://github.com/tejeshkatasani/ledgerline.git
cd ledgerline
npm install
cp .env.example .env
# Edit .env — set DATABASE_URL, JWT_SECRET, AUDIT_HMAC_SECRET
```

### Create the database

```bash
createdb ledgerline
npm run migrate
```

### Start

```bash
npm run dev
# Server starts on http://localhost:3000
```

### Test

```bash
# Set TEST_DATABASE_URL in .env (can be same DB or a separate ledgerline_test)
npm test
```

---

## Deploy to Render

The `render.yaml` Blueprint creates the Node web service and PostgreSQL database.

1. Connect the GitHub repository to Render as a Blueprint.
2. Apply the Blueprint.
3. Render builds the TypeScript API with `npm install && npm run build`.
4. At runtime, `start.js` runs the database migrations and then starts the Express server.
5. Render injects `DATABASE_URL` and generates the JWT and audit HMAC secrets.

The web service serves the browser application from `public/` and the API from the same domain. The health check is `GET /health`.

## Architecture

```
POST /transfers
     │
     ▼
requireAuth middleware       — verify JWT, attach req.user
     │
     ▼
idempotency middleware        — replay if Idempotency-Key already seen
     │
     ▼
validate middleware           — zod schema check
     │
     ▼
transferFunds() service
  ├─ BEGIN SERIALIZABLE
  ├─ SELECT ... FOR UPDATE (both accounts, lower UUID first)
  ├─ Ownership check (fromAccount.user_id === req.user.id)
  ├─ Balance check (balance >= amount)
  ├─ INSERT transactions row (status=pending)
  ├─ UPDATE accounts SET balance = balance - amount  (debit)
  ├─ INSERT ledger_entries (debit)
  ├─ UPDATE accounts SET balance = balance + amount  (credit)
  ├─ INSERT ledger_entries (credit)
  ├─ UPDATE transactions SET status=completed
  ├─ writeAudit() — HMAC hash chain entry
  └─ COMMIT
```

---

## Security Model

See [THREATS.md](./THREATS.md) for the full STRIDE threat model.

Key properties:

| Threat | Control |
|--------|---------|
| Duplicate payment | Idempotency key scoped to (user, path) with PG unique constraint |
| Unauthorised transfer | Ownership check inside serialisable transaction after row lock |
| Overdraft race | SERIALIZABLE isolation + CHECK(balance >= 0) |
| Audit tampering | PostgreSQL append-only trigger + HMAC hash chain |
| Brute force | bcrypt cost 12 + rate limiting on /auth |
| Token forgery | HS256 JWT, secret required at startup |

---

## Running the ten requirements

| # | Requirement | Where |
|---|-------------|-------|
| 1 | Transfer moves money between accounts | `POST /transfers` |
| 2 | Books always balance (double-entry) | `ledger_entries` table, debit = credit |
| 3 | Balance never goes negative | `CHECK (balance >= 0)` + app-layer check |
| 4 | Same request never pays twice | Idempotency-Key + unique constraint |
| 5 | Concurrent transfers handled safely | SERIALIZABLE isolation |
| 6 | Unauthorised transactions rejected | JWT + ownership check in txn |
| 7 | Every event is auditable | append-only audit_log with HMAC chain |
| 8 | Audit log is tamper-evident | DB trigger + hash chain |
| 9 | Closed accounts cannot send | is_active check in ledgerService |
| 10 | Currency mismatch rejected | currency check in ledgerService |
## Known Issues & Pending Improvements

### 1. Audit Chain Integrity Verification
- **Status:** Pending investigation
- **Issue:** Audit integrity verification currently returns `valid: false`.
- **First detected:** Audit record ID 7.
- **Impact:** Audit events are recorded, but complete hash-chain integrity verification is not yet passing.
- **Next steps:**
  - Inspect audit_log database schema.
  - Investigate JSON/JSONB canonicalization.
  - Verify HMAC-SHA256 consistency.
  - Fix verification without deleting existing audit records.
  - Run integrity verification and confirm all tests pass.

### 2. Deployment Verification
- Recheck all production API endpoints.
- Verify database connectivity and migrations.
- Test authentication and account ownership.
- Perform end-to-end transfer testing.