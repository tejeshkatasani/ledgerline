# LedgerLine

Money movement with a ledger you can prove.

**Live URL:** https://ledgerline.onrender.com  
**GitHub:** https://github.com/YOUR_USERNAME/ledgerline

---

## What it does

LedgerLine is a REST API for moving money between accounts where every transaction is:

- **Accurate** — double-entry bookkeeping; every debit has an equal credit
- **Atomic** — SERIALIZABLE PostgreSQL transactions; partial transfers are impossible
- **Idempotent** — same `Idempotency-Key` header never pays twice
- **Authorised** — JWT authentication; you can only move money from accounts you own
- **Traceable** — an append-only, HMAC-chained audit log that detects tampering

---

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
git clone https://github.com/YOUR_USERNAME/ledgerline.git
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

1. Fork this repo to GitHub
2. Create a new **Web Service** on [render.com](https://render.com)
   - Build command: `npm install && npm run build && npm run migrate`
   - Start command: `npm start`
3. Add a **PostgreSQL** database from the Render dashboard
4. Set environment variables in the Render dashboard (Environment tab):

| Variable | Value |
|----------|-------|
| `DATABASE_URL` | (auto-filled by Render PostgreSQL) |
| `JWT_SECRET` | A random 64-character string |
| `AUDIT_HMAC_SECRET` | A different random 64-character string |
| `NODE_ENV` | `production` |

5. Deploy. The `render.yaml` in the repo automates this.

---

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
