# LedgerLine — My Experience Using AI

## 1. How I used AI during this project

I used two AI tools while developing LedgerLine: **Kiro AI and ChatGPT**.

I want to be honest about how I used them. I did not write every line of code independently. I explained my project requirements, discussed the features I wanted, and used these AI tools to generate code and guide me through implementation.

Kiro AI and ChatGPT helped me with backend development, frontend development, database integration, security-related implementation, debugging and deployment.

My role was to explain what I wanted to build, understand the generated implementation, follow the development process, run commands, test features and report problems when something did not work.

I am still learning several of the technologies used in this project. Working on LedgerLine helped me understand how different parts of a real application connect.

## 2. Tools I used

### Kiro AI

I used Kiro AI during the initial development of LedgerLine.

I used it to:
- Understand the project requirements.
- Generate application code.
- Work on backend features and database integration.
- Discuss authentication and transaction functionality.
- Identify and resolve implementation errors.
- Develop the project structure.

### ChatGPT

I used ChatGPT throughout development, especially when I needed explanations or when something was not working as expected.

I used it to:
- Understand generated code and project files.
- Get step-by-step instructions.
- Debug TypeScript, npm and deployment errors.
- Understand authentication, transfers and audit logging.
- Test application functionality.
- Improve documentation.
- Prepare the project for GitHub and Render deployment.

## 3. What I learned during development

### Understanding the application architecture

Initially, I needed guidance to understand how the frontend, Express backend and PostgreSQL database communicate.

While developing LedgerLine, I gradually understood the purpose of:
- API endpoints.
- Authentication middleware.
- Database tables and relationships.
- Request validation.
- Transaction processing.
- Frontend-to-backend communication.

### Understanding financial transfers

I used AI to understand how a transfer should work between two accounts.

I learned that a transfer is not simply updating two account balances. Both sides of the transaction must be handled consistently, and the operation should not leave the database in an incorrect state if something fails.

I also learned about database transactions, row locking and insufficient-funds validation.

### Understanding security

Security was one of the areas where I needed more guidance.

With AI explanations, I learned about:
- JWT authentication.
- Password hashing using bcrypt.
- Account ownership validation.
- SQL injection prevention.
- Idempotency.
- Rate limiting.
- Audit logging.
- HMAC-SHA256 hash chains.

I understand the purpose of these mechanisms better now, but I still need more practical experience implementing and independently reviewing security-sensitive code.

## 4. Problems I faced and how I used AI

### Problem 1 — Local application setup

Initially, I faced issues while setting up and running the project.

I used ChatGPT to understand the terminal commands, project structure, npm dependencies and application startup process.

I followed the instructions and checked whether the application started successfully.

### Problem 2 — Frontend integration

The original project had backend functionality, but I needed a usable frontend.

I used AI to generate frontend files and integrate them with the existing backend.

I then ran the application locally and checked registration, login, account creation and transfer functionality.

### Problem 3 — Audit verification failure

During testing, the audit verification endpoint returned:

`valid: false, firstBadId: 7`

I used ChatGPT to understand the audit service and the HMAC hash-chain implementation.

I also discussed possible JSON/JSONB canonicalization issues.

However, the issue was not resolved during that stage. I documented it in `README.md` and `TODO.md` rather than claiming that the audit verification was working correctly.

### Problem 4 — Render deployment failure

My first frontend deployment failed on Render.

The build logs showed:

`TS2688: Cannot find type definition file for 'jest'.`

With ChatGPT's help, I investigated `tsconfig.json` and `package.json`.

I learned that Jest type definitions were listed under development dependencies, while the production build needed them during TypeScript compilation.

I moved `@types/jest` into production dependencies and ran the build and tests again.

The local build succeeded, all four test suites passed with 30 tests, and I pushed the correction to GitHub.

Render subsequently deployed commit `33bf68d` successfully.

## 5. How I verified the application

I did not rely only on generated code or AI explanations.

I ran the application locally and performed manual checks.

Some of the checks I completed were:

- User registration and login.
- Account creation.
- Transfer between two accounts.
- Transaction history.
- Audit event display.
- Insufficient-funds rejection.
- TypeScript build.
- Automated Jest tests.

The final local test result was:

- Test suites: 4 passed.
- Tests: 30 passed.

I also connected the GitHub repository to Render and verified that the latest deployment became Live.

These checks gave me confidence in the functionality I tested, but they do not prove that every possible security issue has been eliminated.

## 6. My honest reflection

LedgerLine was an opportunity for me to learn how a multi-component application is developed with AI assistance.

I relied heavily on Kiro AI and ChatGPT for code generation and technical guidance. I do not claim that I independently designed and wrote every implementation.

However, I was involved in defining the requirements, understanding the generated code, following the implementation process, running commands, testing functionality, identifying problems and documenting unresolved issues.

I learned that AI-generated code can save development time, but it does not guarantee correctness or security.

I also learned that a successful build and passing tests do not automatically mean an application is production-ready.

My next goal is to improve my understanding of the codebase, investigate the remaining audit integrity issue, strengthen security tests and become more confident in explaining and modifying the implementation independently.

This is an honest record of how I used AI while developing LedgerLine.