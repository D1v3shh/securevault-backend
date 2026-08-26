# SecureVault — Enterprise Secure File Sharing Platform

> Production-grade secure file-sharing backend built with **NestJS**, **TypeScript**, **MongoDB**, **Redis**, and **HashiCorp Vault**.

---

## Table of Contents

- [Features](#features)
- [Tech Stack](#tech-stack)
- [Prerequisites](#prerequisites)
- [Getting Started (From Scratch)](#getting-started-from-scratch)
  - [Step 1 — Clone & Install](#step-1--clone--install)
  - [Step 2 — Start Infrastructure](#step-2--start-infrastructure)
  - [Step 3 — Configure Environment](#step-3--configure-environment)
  - [Step 4 — Setup Vault PKI](#step-4--setup-vault-pki)
  - [Step 5 — Run the Application](#step-5--run-the-application)
  - [Step 6 — Verify Everything Works](#step-6--verify-everything-works)
- [API Walkthrough](#api-walkthrough)
- [API Reference](#api-reference)
- [Architecture](#architecture)
- [Security](#security)
- [Roles (RBAC)](#roles-rbac)
- [Environment Variables](#environment-variables)
- [Scripts](#scripts)
- [Troubleshooting](#troubleshooting)
- [License](#license)

---

## Features

- **JWT Authentication** — Access/refresh token rotation with Redis-backed blacklisting
- **RBAC** — 5 roles (`SUPER_ADMIN`, `ADMIN`, `MANAGER`, `EMPLOYEE`, `VIEWER`) enforced by **exact match**, not inheritance — see [Roles (RBAC)](#roles-rbac)
- **Envelope Encryption** — AES-256-GCM per-file DEKs encrypted by a Vault-managed KEK
- **HashiCorp Vault PKI** — X.509 certificate signing for device trust
- **Device Enrollment** — Token-based onboarding with fingerprint verification
- **Encrypted File Storage** — Files encrypted at rest with SHA-256 integrity checksums
- **Admin User Management** — Create accounts, assign roles, force password resets
- **Audit Logging** — Every sensitive operation tracked with user, IP, and metadata
- **File Sharing** — User-to-user shares with expiry, permission levels, download caps, one-time access and device pinning
- **Rate Limiting** — Configurable via `@nestjs/throttler`
- **Swagger Docs** — Auto-generated OpenAPI documentation
- **Maintenance Scripts** — Retention-based purge of soft-deleted files, run manually (there is no scheduler or queue worker — see [Scripts](#scripts))
- **Health Checks** — MongoDB, Redis, Vault connectivity monitoring

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| **Runtime** | Node.js ≥ 20.x |
| **Framework** | NestJS 11 |
| **Language** | TypeScript 5.x (`strictNullChecks` + `noImplicitAny`; full `strict` is off) |
| **Database** | MongoDB 7 via Mongoose 9 |
| **Cache** | Redis 7 via ioredis |
| **Secrets** | HashiCorp Vault 1.15 |
| **Logging** | winston via `AppLoggerService` (`app.useLogger`) |
| **Auth** | Passport.js + JWT |
| **Validation** | class-validator + Zod (env) |
| **API Docs** | Swagger / OpenAPI |
| **Security** | Helmet, CORS, bcrypt, AES-256-GCM |

---

## Prerequisites

| Tool | Version | Check Command |
|------|---------|---------------|
| **Node.js** | ≥ 20.x | `node --version` |
| **npm** | ≥ 10.x | `npm --version` |
| **Docker** | Latest | `docker --version` |
| **Docker Compose** | v2+ | `docker compose version` |
| **Git** | Latest | `git --version` |

---

## Getting Started (From Scratch)

This guide assumes a **completely fresh setup** — no prior data, no running containers.

### Step 1 — Clone & Install

```bash
git clone https://github.com/D1v3shh/securevault-backend.git
cd securevault-backend
npm install
```

**What happens:** Installs all Node.js dependencies.

### Step 2 — Start Infrastructure

Launch MongoDB, Redis, and HashiCorp Vault using Docker Compose:

```bash
docker compose up -d
```

This starts three containers:

| Service | Port | Container Name | Purpose |
|---------|------|----------------|---------|
| MongoDB 7 | `27017` | `securevault-mongo` | Primary database |
| Redis 7 | `6379` | `securevault-redis` | Token blacklisting, caching |
| Vault 1.15 | `8200` | `securevault-vault` | Secrets management & PKI |

Verify all three are running:

```bash
docker compose ps
```

You should see all three containers with status `Up`.

> **Note:** Vault starts in **dev mode** with root token `dev-root-token`. This is fine for development but must never be used in production.

### Step 3 — Configure Environment

```bash
cp .env.example .env
```

Now open `.env` and set the **two required JWT secrets**. Generate them with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Run the command **twice** and paste each output into:

```env
JWT_ACCESS_SECRET=<paste-first-output-here>
JWT_REFRESH_SECRET=<paste-second-output-here>
```

Then set your super admin credentials (the account created on first startup):

```env
SEED_SUPER_ADMIN_EMAIL=admin@securevault.local
SEED_SUPER_ADMIN_PASSWORD=YourStrongPassword123!
SEED_SUPER_ADMIN_FIRST_NAME=Super
SEED_SUPER_ADMIN_LAST_NAME=Admin
```

> **⚠️ JWT secrets must be at least 32 characters.** The app validates all env vars at boot via Zod and will refuse to start if they're too short.

**Everything else has working defaults** for local development (MongoDB URI, Redis password, Vault token all match `docker-compose.yml`).

### Step 4 — Setup Vault PKI

The PKI engine powers device certificate issuance. Run the setup script **after Vault is running**:

```bash
npx ts-node scripts/setup-vault-pki.ts
```

**What this does (11 steps)** — steps 1–9 set up PKI, steps 10–11 set up the Transit engine:
1. Enables the PKI secrets engine (root)
2. Generates a Root CA (`CN=SecureVault Root CA`, RSA 4096-bit)
3. Configures Root CA URLs (issuing certificates + CRL)
4. Enables an Intermediate PKI secrets engine
5. Generates an Intermediate CA CSR
6. Signs the Intermediate CA with the Root CA
7. Installs the signed Intermediate certificate
8. Configures Intermediate CA URLs
9. Creates the `securevault-device` PKI role for issuing client certificates
10. Enables the Transit secrets engine
11. Creates the `securevault-key` Transit key

You should see:

```
🔐 Setting up Vault PKI at http://localhost:8200
...
✅ Vault PKI and Transit setup complete!
```

> `scripts/setup-transit.ts` does steps 10–11 on their own, if you only need the Transit engine.

> **Note:** Vault runs in dev mode — data is lost on container restart. Re-run this script after `docker compose down -v`.

### Step 5 — Run the Application

```bash
npm run start:dev
```

**What happens on first startup:**
1. Zod validates all environment variables
2. Connects to MongoDB, Redis, and Vault
3. **Auto-seeds the super admin account** using your `SEED_SUPER_ADMIN_*` env vars
4. Starts Swagger docs server
5. Begins listening on port 3000

You should see:

```
✅ Super admin seeded: admin@securevault.local
📄 Swagger docs available at /api/docs
🚀 SecureVault API running on http://0.0.0.0:3000/api/v1
📋 Environment: development
```

### Step 6 — Verify Everything Works

**A) Health check (no auth required):**

```bash
curl http://localhost:3000/api/v1/health
```

Expected: `{"statusCode": 200, "data": {"status": "ok"}, ...}`

**B) Login with the super admin:**

```bash
curl -s -X POST http://localhost:3000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@securevault.local","password":"YourStrongPassword123!"}' | jq
```

Expected: Response containing `accessToken`, `refreshToken`, and user profile.

**C) Open Swagger UI:**

Visit [http://localhost:3000/api/docs](http://localhost:3000/api/docs) in your browser for interactive API documentation.

---

## API Walkthrough

Here's the typical workflow after getting the app running:

### 1. Login → Get Tokens

```bash
# Login as super admin
curl -X POST http://localhost:3000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@securevault.local","password":"YourStrongPassword123!"}'
```

Copy the `accessToken` from the response. Use it as `Bearer <token>` for all subsequent requests.

### 2. Create an Employee User

```bash
curl -X POST http://localhost:3000/api/v1/admin/create-user \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <access_token>" \
  -d '{
    "email": "john.doe@company.com",
    "firstName": "John",
    "lastName": "Doe",
    "role": "EMPLOYEE",
    "department": "Engineering"
  }'
```

The response includes a `temporaryPassword` — the employee must change it on first login.

### 3. Create an Enrollment Token

```bash
curl -X POST http://localhost:3000/api/v1/admin/create-enrollment-token \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <access_token>" \
  -d '{
    "userId": "<user_id_from_step_2>",
    "employeeId": "EMP-001",
    "expiresInHours": 24,
    "maxDevices": 1
  }'
```

### 4. Enroll a Device (SetupApp Flow)

```bash
curl -X POST http://localhost:3000/api/v1/setup/enroll \
  -H "Content-Type: application/json" \
  -d '{
    "enrollmentToken": "<token_from_step_3>",
    "employeeId": "EMP-001",
    "csr": "-----BEGIN CERTIFICATE REQUEST-----\n...\n-----END CERTIFICATE REQUEST-----",
    "deviceFingerprint": "<sha256-device-hash>",
    "hostname": "WORKSTATION-001",
    "platform": "linux",
    "arch": "x64"
  }'
```

The response includes a signed X.509 certificate for the device.

### 5. Upload an Encrypted File

```bash
curl -X POST http://localhost:3000/api/v1/files/upload \
  -H "Authorization: Bearer <access_token>" \
  -F "file=@/path/to/document.pdf"
```

### 6. Download & Decrypt a File

```bash
curl -X GET http://localhost:3000/api/v1/files/<file_id>/download \
  -H "Authorization: Bearer <access_token>" \
  --output downloaded_file.pdf
```

### 7. Share the File With Another User

```bash
curl -X POST http://localhost:3000/api/v1/shares \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <access_token>" \
  -d '{
    "fileId": "<file_uuid_from_step_5>",
    "sharedWithUserId": "<user_id_from_step_2>",
    "permission": "DOWNLOAD",
    "expiresAt": "2026-12-31T23:59:59.000Z",
    "maxDownloads": 5
  }'
```

The recipient then sees it via `GET /shares/shared-with-me` and can download it with the same `GET /files/:id/download` call — the share grant is what authorizes them, since they are not the owner.

---

## API Reference

All endpoints are prefixed with `/api/v1`. Authentication required unless marked **Public**.

The **Auth** column lists the roles that are actually accepted. `RolesGuard` matches roles exactly, so a route accepting `SUPER_ADMIN, ADMIN` lists both — there is no implicit inheritance. Routes marked *Any role* require a valid access token but no specific role.

### Authentication

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| `POST` | `/auth/login` | Login with email + password | Public |
| `POST` | `/auth/certificate-login` | Passwordless X.509 certificate login | Public |
| `POST` | `/auth/refresh` | Rotate refresh token → new token pair | Public + `JwtRefreshGuard` |
| `POST` | `/auth/logout` | Blacklist access token, revoke refresh token, end sessions | Any role |
| `POST` | `/auth/change-password` | Change own password | Any role |
| `POST` | `/auth/force-change-password` | First-login password change | Any role |

`/auth/refresh` is `@Public()` (no access token needed) but guarded by `JwtRefreshGuard`, which verifies the refresh token's signature, expiry and `type` claim. Re-presenting an already-rotated token revokes every refresh token for that user.

### Admin — User & Device Management

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| `POST` | `/admin/create-user` | Create a new user account | `SUPER_ADMIN, ADMIN` |
| `POST` | `/admin/users` | Create a new user account (alias of the above) | `SUPER_ADMIN, ADMIN` |
| `GET` | `/admin/users` | List users (paginated, filterable) | `SUPER_ADMIN, ADMIN` |
| `GET` | `/admin/users/:id` | Get user details by ID | `SUPER_ADMIN, ADMIN` |
| `PATCH` | `/admin/users/:id` | Update user details | `SUPER_ADMIN, ADMIN` |
| `POST` | `/admin/users/:id/activate` | Activate user | `SUPER_ADMIN, ADMIN` |
| `POST` | `/admin/users/:id/deactivate` | Deactivate user | `SUPER_ADMIN, ADMIN` |
| `POST` | `/admin/users/:id/reset-password` | Reset password (returns a temporary one) | `SUPER_ADMIN, ADMIN` |
| `PATCH` | `/admin/users/:id/role` | Change user role | `SUPER_ADMIN` only |
| `POST` | `/admin/create-enrollment-token` | Issue a device enrollment token | `SUPER_ADMIN, ADMIN` |
| `GET` | `/admin/devices` | List all registered devices | `SUPER_ADMIN, ADMIN` |
| `GET` | `/admin/audit-logs` | View audit logs | `SUPER_ADMIN, ADMIN` |

`PATCH /admin/users/:id/role` is additionally constrained in `AdminService.validateRoleChange`: you may only assign a role strictly below your own, and you cannot change your own role.

### Setup — Device Enrollment (SetupApp-facing, all public)

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| `POST` | `/setup/verify-token` | Validate an enrollment token before enrolling | Public |
| `POST` | `/setup/enroll` | Enroll device + issue certificate | Public |
| `POST` | `/setup/generate-certificate` | Sign a CSR outside the enrollment flow | Public |
| `POST` | `/setup/renew-certificate` | Renew a device certificate | Public |

`POST /setup/generate-certificate` signs a CSR and stores the certificate without an enrollment token. It is `@Public()` and rate-limited to 3 requests/minute; certificates issued this way are attributed to a reserved system user rather than a real account.

### Certificates

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| `POST` | `/certificates/verify` | Verify a presented certificate | Public |
| `POST` | `/certificates/revoke` | Revoke a certificate (also ends that device's sessions) | `SUPER_ADMIN, ADMIN` |
| `GET` | `/certificates/:serial` | Get certificate details | Any role |
| `GET` | `/certificates/status/:serial` | Get certificate status | Any role |

### Devices

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| `POST` | `/devices/register` | Register a device | Any role |
| `GET` | `/devices/me` | List own devices | Any role |
| `GET` | `/devices/:id` | Get device details | Any role |
| `PATCH` | `/devices/:id/status` | Approve / revoke / block a device | `SUPER_ADMIN, ADMIN` |

Revoking or blocking a device ends its active sessions.

### Files

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| `POST` | `/files/upload` | Upload and encrypt a file | Any role |
| `GET` | `/files` | List accessible files (paginated) | Any role |
| `GET` | `/files/:id` | Get file metadata | Any role |
| `GET` | `/files/:id/download` | Download and decrypt | Any role |
| `DELETE` | `/files/:id` | Soft delete a file | Owner or `SUPER_ADMIN, ADMIN` |

File read access is decided per file, in this order: the **owner** and `SUPER_ADMIN` / `ADMIN` always pass; then the file's own `accessLevel` (`internal` and `public` are readable by any authenticated user, `department` additionally by `MANAGER`); then, for everyone else, an active share grant. Anything else is a 403.

### Shares — File Sharing

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| `POST` | `/shares` | Share one of your files with another user | Any role (file owner) |
| `GET` | `/shares/shared-with-me` | List files shared with you (paginated) | Any role |
| `GET` | `/shares/shared-by-me` | List files you have shared (paginated) | Any role |
| `GET` | `/shares/:shareId` | Get details of a specific share | Owner or recipient |
| `DELETE` | `/shares/:shareId` | Revoke a share | Any role (file owner) |

Creating a share requires `fileId`, `sharedWithUserId`, `permission` and a future `expiresAt`. Ownership is read from the database, never trusted from the request. Optional enterprise controls: `maxDownloads`, `oneTimeAccess`, `watermarkEnabled` and `allowedDeviceCertificateId` (device pinning).

Permission levels are ordered `VIEW` < `DOWNLOAD` < `EDIT` < `FULL_ACCESS`: a `VIEW` share exposes metadata but will not authorize a download. Shares expire lazily — an expired share flips to `EXPIRED` on the next access attempt. A completed download counts against `maxDownloads` only after the transfer finishes.

Both list endpoints accept `page`, `limit`, `status`, `sortBy` (`createdAt`, `expiresAt`, `fileName`), `sortOrder` and `search` (matches file name).

### Users — Self Service

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| `GET` | `/users/me` | Get own profile | Required |
| `PATCH` | `/users/me` | Update own profile | Required |

### Health

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| `GET` | `/health` | Basic health check | Public |
| `GET` | `/health/detailed` | Detailed (Mongo, Redis, Vault) | Required |

---

## Architecture

```
src/
├── main.ts                        # Bootstrap — Helmet, CORS, Swagger, Pipes, Filters
├── app.module.ts                  # Root module wiring + super admin seed
├── config/                        # Environment config (Zod-validated)
├── common/                        # Shared filters, interceptors, DTOs
├── shared/                        # Logger, constants, crypto/file utils
└── modules/
    ├── auth/                      # JWT auth, strategies, guards, decorators
    ├── users/                     # User CRUD, schema, password management
    ├── admin/                     # Admin user management, audit viewing
    ├── files/                     # File upload/download with encryption
    ├── permissions/               # RBAC roles, hierarchy, permissions
    ├── encryption/                # AES-256-GCM envelope encryption
    ├── vault/                     # HashiCorp Vault integration
    ├── storage/                   # Storage abstraction (local, S3-ready)
    ├── audit/                     # Audit logging with structured events
    ├── queue/                     # FileProcessor — retention purge + orphan check, invoked by scripts/
    ├── health/                    # Health check endpoints
    ├── redis/                     # Global Redis client provider
    ├── database/                  # MongoDB connection module
    ├── devices/                   # Device trust management
    ├── certificates/              # X.509 certificate operations
    ├── setup/                     # Device enrollment (SetupApp)
    ├── sessions/                  # Session records (certificate + password logins)
    └── shares/                    # File sharing with expiry, caps, device pinning
```

---

## Security

| Layer | Implementation |
|-------|---------------|
| **Password Hashing** | bcrypt with 12 salt rounds |
| **Access Tokens** | JWT — 15-minute expiry |
| **Refresh Tokens** | JWT — 7-day expiry with rotation |
| **Token Blacklisting** | Redis-backed revocation on logout |
| **Refresh Token Storage** | SHA-256 hashed (never stored raw) |
| **File Encryption** | AES-256-GCM per-file DEKs |
| **Key Management** | HashiCorp Vault-managed KEK (envelope encryption) |
| **Device Trust** | X.509 client certificates via Vault PKI |
| **Rate Limiting** | `@nestjs/throttler` — configurable per-endpoint |
| **HTTP Headers** | Helmet security headers |
| **CORS** | Configurable origin restrictions |
| **Input Validation** | class-validator with whitelist mode |
| **Account Lockout** | 5 failed attempts → 30 min lockout |
| **Audit Trail** | All sensitive operations logged |

---

## Roles (RBAC)

There are five roles. **`RolesGuard` matches roles exactly — it does not implement inheritance.**

| Role | Level | What it can reach today |
|------|-------|-------------------------|
| `SUPER_ADMIN` | 100 | Everything below, plus `PATCH /admin/users/:id/role` |
| `ADMIN` | 80 | All `/admin` routes except role changes, certificate revoke, device status |
| `MANAGER` | 60 | No dedicated routes; only grants read access to `department`-level files |
| `EMPLOYEE` | 40 | Files, shares, devices, self-service |
| `VIEWER` | 20 | Same routes as `EMPLOYEE` — no route-level restriction exists yet |

### What "exact match" means in practice

`RolesGuard` is a plain `requiredRoles.includes(user.role)` check. A route decorated `@Roles(Role.ADMIN)` would reject a `SUPER_ADMIN` request, because `SUPER_ADMIN` is not in the list. Nothing is broken today only because every route that needs both lists both:

```ts
@Roles(Role.SUPER_ADMIN, Role.ADMIN)   // correct — both listed
@Roles(Role.ADMIN)                     // would lock out SUPER_ADMIN
```

**When adding a route, list every permitted role explicitly.** Do not rely on the level numbers above to grant access.

The `Level` column comes from `ROLE_HIERARCHY`, which has exactly one runtime consumer: `AdminService.validateRoleChange`, where it enforces that you may only assign a role strictly below your own. It plays no part in route authorization.

### Not yet implemented

A `Permission` enum and a `ROLE_PERMISSIONS` matrix exist in `src/modules/permissions/`, along with a `PermissionsService` and a `permissions` collection. **Nothing reads them at runtime** — they are a design sketch for a future permission-based model. Route access is decided solely by `@Roles` + `RolesGuard`, plus ownership and share checks inside the file services.

---

## Environment Variables

See [`.env.example`](.env.example) for the complete template. Key variables:

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `MONGODB_URI` | **Yes** | — | MongoDB connection string |
| `JWT_ACCESS_SECRET` | **Yes** | — | Min 32 chars |
| `JWT_REFRESH_SECRET` | **Yes** | — | Min 32 chars |
| `VAULT_ENABLED` | No | `false` | Enable HashiCorp Vault |
| `VAULT_TOKEN` | No | — | Vault access token |
| `SEED_SUPER_ADMIN_EMAIL` | No | — | Auto-seed admin on first run |
| `SEED_SUPER_ADMIN_PASSWORD` | No | — | Admin password (min 8 chars) |

---

## Scripts

```bash
# Development
npm run start:dev          # Hot-reload (watch mode)
npm run start:debug        # Debugger + hot-reload
npm run start              # No hot-reload

# Production
npm run build              # Compile TypeScript → dist/
npm run start:prod         # Run compiled dist/main.js

# Code Quality
npm run lint               # ESLint — note: includes --fix and rewrites source files
npx eslint "src/**/*.ts"   # Inspect only, no rewriting
npm run format             # Prettier formatting

# Testing
npm run test               # Unit/service tests — src/**/*.spec.ts, no external services needed
npm run test:watch         # Watch mode
npm run test:cov           # Coverage report
npm run test:e2e           # HTTP smoke tests — test/*.e2e-spec.ts (Mongo/Redis/Vault stubbed)

# Infrastructure
docker compose up -d       # Start MongoDB, Redis, Vault
docker compose down        # Stop services
docker compose down -v     # Stop + delete all data (clean reset)

# One-off maintenance (run manually — there is no scheduler)
npx ts-node scripts/setup-vault-pki.ts              # Root + Intermediate CA, device role, Transit (11 steps)
npx ts-node scripts/setup-transit.ts                # Transit engine + securevault-key only
npx ts-node scripts/backfill-certificate-serials.ts # Populate certificates.serialNumberNormalized + index
npx ts-node scripts/cleanup-expired-files.ts        # DRY RUN: list files soft-deleted >30 days
```

### Purging soft-deleted files

`DELETE /files/:id` is a **soft** delete: the row is flagged and the encrypted blob stays on disk. Nothing removes it automatically — no cron, no queue worker. Purging is a manual, deliberate step:

```bash
npx ts-node scripts/cleanup-expired-files.ts                     # dry run (default)
npx ts-node scripts/cleanup-expired-files.ts --limit=25           # dry run, first 25
npx ts-node scripts/cleanup-expired-files.ts --confirm            # actually purge
npx ts-node scripts/cleanup-expired-files.ts --confirm --performed-by=<userId>
```

> **This is irreversible.** It deletes the blob *and* the metadata row holding the wrapped per-file key, so a purged file cannot be decrypted even if the ciphertext is restored from a backup. Only files soft-deleted more than 30 days ago are eligible, runs are capped (default 100 files), and every purge writes an audit entry before deleting. Always dry-run first.

---

## Troubleshooting

### Environment validation error at startup

The app validates all env vars at boot using Zod. Check the specific field in the error against `.env.example`.

### JWT secrets too short

Both `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET` must be **≥ 32 characters**:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### Docker containers won't start

```bash
# Check if ports are in use
sudo lsof -i :27017 -i :6379 -i :8200

# Force recreate
docker compose up -d --force-recreate
```

### MongoDB authentication failed

Ensure `MONGODB_URI` matches `docker-compose.yml` credentials:

```env
MONGODB_URI=mongodb://securevault_user:securevault_pass_dev@localhost:27017/securevault?authSource=admin
```

### Vault PKI not working

Re-run the setup script (Vault dev mode loses data on restart):

```bash
npx ts-node scripts/setup-vault-pki.ts
```

### Clean reset (start completely fresh)

```bash
docker compose down -v     # Destroy all data volumes
docker compose up -d       # Recreate containers
npx ts-node scripts/setup-vault-pki.ts  # Re-setup PKI
npm run start:dev          # App re-seeds super admin
```

---

## License

UNLICENSED — Private repository
