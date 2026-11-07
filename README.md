# LedgerLine

### Money movement with a ledger you can prove.

LedgerLine is a financial workspace with a browser-based dashboard and REST API for managing accounts and transferring money.

The project was initially developed with Kiro AI, which generated the backend and REST API. After my Kiro credits were exhausted, I continued development with ChatGPT assistance, adding the browser frontend, integrating it with the existing backend, testing the application, debugging issues and preparing the deployment.

**Live Application:** https://ledgerline-mbwz.onrender.com

**GitHub Repository:** https://github.com/tejeshkatasani/ledgerline

---

## 1. Project Overview

LedgerLine focuses on secure money movement and financial transaction management.

The application provides:

- User registration and login.
- Account creation and management.
- Transfers between accounts.
- Double-entry ledger records.
- Transaction history.
- Audit event logging.
- Audit-chain integrity verification.

The main design principles are:

- **Accuracy:** Transfers create corresponding debit and credit ledger entries.
- **Atomicity:** PostgreSQL transactions help prevent partially completed transfers.
- **Idempotency:** An `Idempotency-Key` mechanism protects against duplicate transfer requests.
- **Authorization:** JWT authentication and account ownership checks protect user resources.
- **Traceability:** Audit events are recorded using an append-only design and HMAC-SHA256 hash chaining.

**Known limitation:** Full audit-chain verification is currently unresolved. Details are documented in the Known Issues section.

---

## 2. Development History

LedgerLine was developed in two main stages.

### Stage 1 — Backend development with Kiro AI

I initially used Kiro AI to build the backend and REST API.

The original backend project included:

- Express application setup.
- TypeScript configuration.
- PostgreSQL database integration.
- Database migrations.
- User registration and authentication.
- Account management endpoints.
- Transfer processing.
- Transaction history.
- Audit logging.
- Automated tests.

Kiro AI generated much of the initial backend implementation based on the requirements I provided.

### Stage 2 — Frontend integration and further development

After my Kiro credits were exhausted, I continued working with ChatGPT.

The additional work included:

- Creating the browser frontend.
- Adding `public/index.html`.
- Adding `public/styles.css`.
- Adding `public/app.js`.
- Integrating the frontend with the existing Express application through `src/app.ts`.
- Running and testing the application locally.
- Debugging frontend and backend issues.
- Updating project documentation.
- Preparing GitHub and Render deployment.
- Resolving a TypeScript dependency issue during production deployment.

I used AI assistance throughout this process to understand the code, follow implementation steps, troubleshoot errors and verify functionality.

---

## 3. Technology Stack

| Component | Technology |
|---|---|
| Backend | Node.js, Express.js |
| Language | TypeScript |
| Database | PostgreSQL |
| Database library | node-postgres (`pg`) |
| Authentication | JSON Web Tokens |
| Password hashing | bcrypt |
| Request validation | Zod |
| Frontend | HTML, CSS, JavaScript |
| Testing | Jest, Supertest |
| Deployment | Render |
| Version control | Git, GitHub |
| AI development tools | Kiro AI, ChatGPT |

---

## 4. Browser Application

The browser dashboard is served directly by the Express application.

**Live URL:** https://ledgerline-mbwz.onrender.com

The frontend is located in the `public/` directory.

### Main application screens

**Authentication**
- User login.
- New user registration.

**Dashboard**
- Total account balance.
- Active account count.
- Transaction count.
- Account overview.
- Recent activity.

**Accounts**
- Create accounts.
- View account balances.
- Manage account status.
- Close eligible accounts.

**Transfers**
- Select a source account.
- Enter the destination account UUID.
- Specify transfer amount and currency.
- Review and confirm transfers.

**Transactions**
- View transaction history.
- Review transfer details and status.

**Audit Trail**
- View recorded audit events.
- Request audit-chain integrity verification.

The frontend uses the same origin as the REST API. It does not require a separate frontend hosting service.

---

## 5. Backend and API Reference

The Express backend exposes REST endpoints for authentication, accounts, transfers, transactions and audit operations.

All protected endpoints require:

```text
Authorization: Bearer <jwt>
```

### Authentication

| Method | Endpoint | Description |
|---|---|---|
| POST | `/auth/register` | Register a new user |
| POST | `/auth/login` | Authenticate a user |

### Accounts

| Method | Endpoint | Description |
|---|---|---|
| GET | `/accounts` | List the authenticated user's accounts |
| POST | `/accounts` | Create an account |
| GET | `/accounts/:id` | Retrieve account details |
| DELETE | `/accounts/:id` | Close an account, subject to balance validation |

### Transfers

| Method | Endpoint | Description |
|---|---|---|
| POST | `/transfers` | Transfer funds between accounts |

Example request:

```json
{
  "from_account_id": "SOURCE_ACCOUNT_UUID",
  "to_account_id": "DESTINATION_ACCOUNT_UUID",
  "amount": "5000.00",
  "currency": "INR"
}
```

For idempotency, include:

```text
Idempotency-Key: <unique-key>
```

### Transactions

| Method | Endpoint | Description |
|---|---|---|
| GET | `/transactions` | List transactions involving the authenticated user |
| GET | `/transactions/:id` | Retrieve transaction details and ledger entries |
| GET | `/transactions/account/:id/ledger` | Retrieve an account's paginated ledger |

### Audit

| Method | Endpoint | Description |
|---|---|---|
| GET | `/audit` | Retrieve the authenticated user's audit events |
| GET | `/audit/verify` | Verify the full audit chain |

### Health

| Method | Endpoint | Description |
|---|---|---|
| GET | `/health` | Check application health |

---

## 6. Architecture

LedgerLine uses an Express-based backend with separate route, middleware, service, database and utility modules.

### Transfer processing flow

```text
                 Client
                   |
                   v
             Express API
                   |
                   v
          Authentication
                   |
                   v
          Request Validation
                   |
                   v
         Idempotency Handling
                   |
                   v
          Transfer Route
                   |
                   v
         Transfer Service
                   |
                   v
       PostgreSQL Transaction
          SERIALIZABLE
                   |
                   v
         Account Validation
                   |
                   v
          Balance Validation
                   |
                   v
          Debit Operation
                   |
                   v
       Debit Ledger Entry
                   |
                   v
         Credit Operation
                   |
                   v
      Credit Ledger Entry
                   |
                   v
       Transaction Completion
                   |
                   v
             Audit Event
                   |
                   v
                COMMIT
```

### Important implementation concepts

**Database transactions**

Transfer processing uses PostgreSQL transactions to maintain consistency.

**SERIALIZABLE isolation**

The transfer service uses SERIALIZABLE isolation to handle conflicting database operations.

**Row-level locking**

The implementation locks account records using `SELECT ... FOR UPDATE`, with a consistent ordering strategy.

**Double-entry bookkeeping**

A transfer creates corresponding debit and credit ledger entries.

**Audit logging**

The audit service records events and links records using HMAC-SHA256 hash chaining.

---

## 7. Security Implementation

Security is an important part of LedgerLine because the application handles financial information and money movement.

The implementation includes the following controls.

### Authentication
- JWT-based authentication.
- Password hashing using bcrypt.
- Protected API routes.
- Required environment-based secrets.

### Authorization
- Account ownership validation.
- Protected account operations.
- Ownership checks during transfer processing.

### Transaction security
- PostgreSQL transactions.
- SERIALIZABLE isolation.
- Row-level locking.
- Balance validation.
- Database-level balance constraints.
- Idempotency protection.

### Request security
- Zod request validation.
- Parameterized PostgreSQL queries.
- Express security headers through Helmet.
- Request body size limits.
- General API rate limiting.
- Stricter rate limiting for authentication endpoints.

### Audit security
- Append-only audit-log protection.
- Database trigger protection against UPDATE and DELETE.
- HMAC-SHA256 hash chaining.
- Audit verification endpoint.

**Important:** Audit logging and audit-chain integrity verification are separate concerns. Audit records are being created, but the complete chain verification currently has an unresolved issue.

For the detailed threat analysis, see [THREATS.md](./THREATS.md).

---

## 8. Functional Requirements

The project addresses the ten core financial transaction requirements.

### 1. Transfer between accounts

Implemented through `POST /transfers`.

A local transfer of ₹5,000 was successfully completed during manual testing.

### 2. Double-entry bookkeeping

Implemented through the `ledger_entries` table with corresponding debit and credit entries.

Automated tests check that the two entries are created and have matching amounts.

### 3. Prevent negative balances

Implemented using application-level balance validation and database constraints.

A local transfer exceeding the available balance was rejected successfully.

### 4. Prevent duplicate transfers

Implemented using idempotency keys and PostgreSQL uniqueness protection.

The automated tests check repeated requests and key reuse with different transfer details.

### 5. Handle concurrent transfers

Implemented using SERIALIZABLE transactions and row-level locking.

Additional simultaneous-transfer testing is still required to establish the full concurrency guarantees.

### 6. Reject unauthorized transactions

Implemented using JWT authentication and account ownership validation.

Automated tests include attempts to transfer from another user's account.

### 7. Record audit events

Implemented using the audit service and `audit_log` table.

Audit events were visible during local application testing.

### 8. Detect audit tampering

Implemented using database mutation protection and HMAC hash chaining.

Full integrity verification remains unresolved because the verification endpoint returned `valid: false`.

### 9. Prevent transfers from closed accounts

Implemented using account active-status validation.

The transfer test suite includes a closed-account rejection test.

### 10. Reject currency mismatch

Currency validation is included in transfer processing.

A separate explicit negative-test result still needs to be confirmed before claiming complete verification.

---

## 9. Testing

LedgerLine uses Jest and Supertest for automated API testing.

### Test files

| File | Purpose |
|---|---|
| `tests/auth.test.ts` | Registration and authentication |
| `tests/accounts.test.ts` | Account creation, ownership and closure |
| `tests/transfers.test.ts` | Transfers, balances, idempotency and validation |
| `tests/audit.test.ts` | Audit logging and integrity checks |

### Latest local test result

The latest reported local test execution completed successfully:

```text
Test Suites: 4 passed, 4 total
Tests:       30 passed, 30 total
Snapshots:   0 total
```

The TypeScript build also completed successfully:

```bash
npm run build
```

The successful test run confirms the current automated suite passed. It does not prove that all production security scenarios have been verified.

---

## 10. Running Locally

### Prerequisites

- Node.js 18 or later.
- PostgreSQL 14 or later.
- Git.
- npm.

### Step 1 — Clone the repository

```bash
git clone https://github.com/tejeshkatasani/ledgerline.git

cd ledgerline
```

### Step 2 — Install dependencies

```bash
npm install
```

### Step 3 — Configure environment variables

Copy the example environment file.

Windows PowerShell:

```powershell
Copy-Item .env.example .env
```

Configure the required values in `.env`:

```text
DATABASE_URL=
JWT_SECRET=
AUDIT_HMAC_SECRET=
```

Use strong, unique secrets. Never commit your actual `.env` file to GitHub.

### Step 4 — Create the database

```bash
createdb ledgerline
```

Configure `DATABASE_URL` to point to your PostgreSQL database.

### Step 5 — Run migrations

```bash
npm run migrate
```

### Step 6 — Start the application

```bash
npm run dev
```

Open:

http://localhost:3000

### Step 7 — Run automated tests

Configure `TEST_DATABASE_URL` in `.env` according to the test database setup.

Then run:

```bash
npm test
```

### Step 8 — Build the application

```bash
npm run build
```

---

## 11. Deployment on Render

LedgerLine is deployed on Render and connected to the GitHub repository.

**Live Application:**

https://ledgerline-mbwz.onrender.com

**GitHub Repository:**

https://github.com/tejeshkatasani/ledgerline

### Deployment configuration

The `render.yaml` Blueprint defines the Node.js web service and PostgreSQL database.

The build command is:

```bash
npm install && npm run build
```

The start command is:

```bash
node start.js
```

The production startup script:

1. Executes the compiled database migration script.
2. Stops startup if migrations fail.
3. Starts the compiled Express application.

Render configuration supplies the database connection and generates the JWT and audit HMAC secrets.

The health-check endpoint is:

```text
GET /health
```

### Deployment history

The frontend integration and documentation were pushed to GitHub.

The first deployment of that update failed because TypeScript could not find Jest type definitions during the production build.

I investigated the build log with ChatGPT and moved `@types/jest` into production dependencies.

After the correction:

- The local TypeScript build succeeded.
- All four local test suites passed.
- All 30 local tests passed.
- The correction was committed and pushed to GitHub.

**Latest verified deployment:**

- Commit: `33bf68d`
- Commit message: `Fix Jest type definitions for Render production build`
- Platform: Render
- Deployment status: Live

A successful deployment confirms that Render built and started the service. Full production end-to-end testing is still required.

---

## 12. Known Issues and Pending Improvements

I have documented unresolved issues rather than claiming that every security feature is fully verified.

### 1. Audit Chain Integrity Verification

**Status: Pending investigation — Critical**

During local testing, the audit verification endpoint returned:

```json
{
  "success": true,
  "data": {
    "valid": false,
    "firstBadId": 7
  }
}
```

**Impact:**

Audit events are being recorded, but complete hash-chain integrity verification is not passing in the observed local application data.

**Next steps:**

- Inspect the `audit_log` database schema.
- Investigate JSON/JSONB canonicalization.
- Verify HMAC-SHA256 consistency.
- Review previous-hash handling.
- Fix verification without deleting historical audit records.
- Add tests for modified, deleted and reordered audit records.
- Re-run verification against a clean database and existing records.

### 2. Production End-to-End Verification

**Status: Initial deployment successful; full verification pending.**

The latest deployment is Live.

Remaining checks include:

- Production registration and login.
- Account creation and account ownership.
- Successful and unsuccessful transfers.
- Transaction history.
- Invalid transfer requests.
- Audit event recording.
- Audit-chain verification.
- Production database connectivity and migrations.

### 3. Future Security Improvements

Areas I want to improve further:

- Multi-factor authentication.
- Refresh-token rotation.
- Database role separation.
- Distributed rate limiting.
- Broader cross-user authorization tests.
- Concurrent transfer stress testing.
- Additional monitoring and security logging.

---

## 13. AI-Assisted Development

I used Kiro AI and ChatGPT during the development of LedgerLine.

Kiro AI was used for the initial backend and REST API development.

After my Kiro credits were exhausted, I continued with ChatGPT assistance to add and integrate the frontend, understand the existing codebase, debug errors, test application functionality, update documentation and prepare the Render deployment.

I did not independently write every line of code. I provided requirements, followed the development process, ran commands, tested features, reported issues and worked to understand the generated implementation.

The two supporting documents are:

- [THREATS.md](./THREATS.md) — My threat model and security considerations.
- [PROMPTS.md](./PROMPTS.md) — My experience using AI during development.

This project helped me understand how backend APIs, databases, browser interfaces, financial transactions and deployment work together.

It also taught me that AI-generated code must be reviewed and tested rather than accepted blindly.

---

## 14. Project Structure

```text
LedgerLine/
│
├── .github/
│   └── workflows/
│
├── public/
│   ├── index.html
│   ├── styles.css
│   └── app.js
│
├── src/
│   ├── app.ts
│   ├── index.ts
│   ├── db/
│   │   ├── pool.ts
│   │   └── migrate.ts
│   ├── middleware/
│   ├── routes/
│   ├── services/
│   ├── utils/
│   └── types/
│
├── tests/
│   ├── auth.test.ts
│   ├── accounts.test.ts
│   ├── transfers.test.ts
│   ├── audit.test.ts
│   └── setup.ts
│
├── .env.example
├── .gitignore
├── jest.config.js
├── package.json
├── package-lock.json
├── render.yaml
├── start.js
├── tsconfig.json
├── README.md
├── THREATS.md
└── PROMPTS.md
```

---

## 15. Final Note

LedgerLine is my AI-assisted financial ledger project.

I used Kiro AI for the initial backend and REST API development and continued with ChatGPT after my Kiro credits were exhausted.

Through this project, I worked on frontend integration, application testing, debugging, documentation and deployment.

I am continuing to improve my understanding of the implementation, especially around transaction security and audit integrity.

**Developer:** Katasani Tejeswara Reddy

**GitHub:** https://github.com/tejeshkatasani/ledgerline

**Live Application:** https://ledgerline-mbwz.onrender.com