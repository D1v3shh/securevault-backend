# SecureVault — Enterprise Secure File Sharing Platform

> Production-grade secure file-sharing backend built with **NestJS**, **TypeScript**, **MongoDB**, **Redis**, and **HashiCorp Vault**.

---

## Table of Contents

- [Features](#features)
- [Architecture](#architecture)
- [Tech Stack](#tech-stack)
- [Prerequisites](#prerequisites)
- [Getting Started](#getting-started)
  - [1. Clone the Repository](#1-clone-the-repository)
  - [2. Install Dependencies](#2-install-dependencies)
  - [3. Start Infrastructure (Docker)](#3-start-infrastructure-docker)
  - [4. Configure Environment](#4-configure-environment)
  - [5. Run the Application](#5-run-the-application)
- [API Reference](#api-reference)
  - [Authentication](#authentication)
  - [Admin — User Management](#admin--user-management)
  - [Files](#files)
  - [Users — Self Service](#users--self-service)
  - [Health](#health)
- [Security](#security)
- [Role Hierarchy (RBAC)](#role-hierarchy-rbac)
- [Environment Variables](#environment-variables)
- [All Available Scripts](#all-available-scripts)
- [Project Structure](#project-structure)
- [Troubleshooting](#troubleshooting)
- [License](#license)

---

## Features

- **Authentication & Authorization** — JWT-based auth with access/refresh token rotation, token blacklisting via Redis
- **Role-Based Access Control (RBAC)** — 5-tier hierarchy: `SUPER_ADMIN` → `ADMIN` → `MANAGER` → `EMPLOYEE` → `VIEWER`
- **Envelope Encryption** — AES-256-GCM with per-file DEKs encrypted by a Vault-managed KEK
- **HashiCorp Vault Integration** — Secrets management and encryption key storage
- **Encrypted File Storage** — Files encrypted at rest with integrity verification (SHA-256 checksums)
- **Admin User Management** — Create accounts, assign roles, force password resets, activate/deactivate users
- **Comprehensive Audit Logging** — Every sensitive operation tracked with user, IP, and metadata
- **Rate Limiting** — Configurable rate limits via `@nestjs/throttler`
- **API Documentation** — Auto-generated Swagger/OpenAPI docs
- **Background Processing** — BullMQ-based queues for async audit logging and file cleanup
- **Health Checks** — System health endpoints for monitoring (MongoDB, Redis, Vault)
- **Super Admin Seeding** — Automatic first-run admin account creation

---

## Architecture

```
src/
├── main.ts                        # Bootstrap — Helmet, CORS, Swagger, Pipes, Filters
├── app.module.ts                  # Root module wiring + super admin seed
├── config/                        # Environment config (Zod-validated)
│   ├── app.config.ts
│   ├── configuration.ts           # Aggregates all config loaders
│   ├── database.config.ts
│   ├── env.validation.ts          # Zod schema for all env vars
│   ├── jwt.config.ts
│   ├── redis.config.ts
│   ├── storage.config.ts
│   └── vault.config.ts
├── common/                        # Shared filters, interceptors, DTOs
│   ├── dto/pagination.dto.ts
│   ├── filters/http-exception.filter.ts
│   └── interceptors/
│       ├── logging.interceptor.ts
│       └── transform.interceptor.ts
├── shared/                        # Logger, constants, crypto/file utils
│   ├── constants/app.constants.ts
│   ├── logger/logger.service.ts
│   └── utils/
│       ├── crypto.util.ts
│       └── file.util.ts
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
    ├── queue/                     # Background processors (audit, files)
    ├── health/                    # Health check endpoints
    ├── redis/                     # Global Redis client provider
    └── database/                  # MongoDB connection module
```

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Runtime** | Node.js ≥ 20.x |
| **Framework** | NestJS 11 |
| **Language** | TypeScript 5.x (strict mode) |
| **Database** | MongoDB 7 via Mongoose 9 |
| **Cache / Sessions** | Redis 7 via ioredis |
| **Secrets Management** | HashiCorp Vault 1.15 |
| **Queue** | BullMQ (Redis-backed) |
| **Auth** | Passport.js + JWT |
| **Validation** | class-validator + Zod (env) |
| **API Docs** | Swagger / OpenAPI via `@nestjs/swagger` |
| **Security** | Helmet, CORS, bcrypt, AES-256-GCM |

---

## Prerequisites

Before you begin, make sure you have the following installed:

| Tool | Version | Check Command |
|------|---------|---------------|
| **Node.js** | ≥ 20.x | `node --version` |
| **npm** | ≥ 10.x | `npm --version` |
| **Docker** | Latest | `docker --version` |
| **Docker Compose** | v2+ | `docker compose version` |
| **Git** | Latest | `git --version` |

---

## Getting Started

### 1. Clone the Repository

```bash
git clone https://github.com/D1v3shh/securevault-backend.git
cd securevault-backend
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Start Infrastructure (Docker)

This starts MongoDB, Redis, and HashiCorp Vault containers for local development:

```bash
docker compose up -d
```

**Services started:**

| Service | Port | Container Name |
|---------|------|----------------|
| MongoDB 7 | `localhost:27017` | `securevault-mongo` |
| Redis 7 | `localhost:6379` | `securevault-redis` |
| HashiCorp Vault | `localhost:8200` | `securevault-vault` |

To verify all containers are running:

```bash
docker compose ps
```

To view container logs:

```bash
# All services
docker compose logs -f

# Specific service
docker compose logs -f mongodb
docker compose logs -f redis
docker compose logs -f vault
```

To stop all services:

```bash
docker compose down
```

To stop and remove all data (clean reset):

```bash
docker compose down -v
```

### 4. Configure Environment

```bash
# Copy the template
cp .env.example .env
```

Edit `.env` and fill in the required values. The defaults in `.env.example` are configured to work with the Docker Compose services out of the box.

**Minimum required changes for local development:**

```env
# JWT secrets — MUST be at least 32 characters
JWT_ACCESS_SECRET=your-access-secret-at-least-32-characters-long!!
JWT_REFRESH_SECRET=your-refresh-secret-at-least-32-characters-long!!

# Super Admin seed credentials (created on first startup)
SEED_SUPER_ADMIN_EMAIL=admin@securevault.local
SEED_SUPER_ADMIN_PASSWORD=YourStrongPassword123!
SEED_SUPER_ADMIN_FIRST_NAME=System
SEED_SUPER_ADMIN_LAST_NAME=Administrator
```

> **⚠️ Important:** JWT secrets must be at least 32 characters. The app will refuse to start if they're shorter (validated by Zod at boot).

### 5. Run the Application

#### Development Mode (with hot-reload)

```bash
npm run start:dev
```

#### Production Mode

```bash
# Build the project
npm run build

# Start the production server
npm run start:prod
```

#### Debug Mode

```bash
npm run start:debug
```

### 6. Verify It's Running

Once the app starts, you should see output like:

```
🚀 SecureVault API running on http://0.0.0.0:3000/api/v1
📄 Swagger docs available at /docs
📋 Environment: development
```

**Access points:**

| Endpoint | URL |
|----------|-----|
| **API Base** | `http://localhost:3000/api/v1` |
| **Swagger Docs** | `http://localhost:3000/docs` |
| **Health Check** | `http://localhost:3000/api/v1/health` |

#### Quick Smoke Test

```bash
# Health check (public — no auth needed)
curl http://localhost:3000/api/v1/health

# Login with the seeded super admin
curl -X POST http://localhost:3000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@securevault.local","password":"YourStrongPassword123!"}'
```

---

## API Reference

All endpoints are prefixed with `/api/v1`. Authentication is required unless marked **Public**.

### Authentication

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| `POST` | `/auth/login` | Login with email + password | Public |
| `POST` | `/auth/refresh` | Refresh access token | Public |
| `POST` | `/auth/logout` | Logout (revoke tokens) | Required |
| `POST` | `/auth/change-password` | Change own password | Required |
| `POST` | `/auth/force-change-password` | First-login password change | Required |

### Admin — User Management

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| `POST` | `/admin/users` | Create a new user | SUPER_ADMIN, ADMIN |
| `GET` | `/admin/users` | List all users (paginated) | SUPER_ADMIN, ADMIN |
| `GET` | `/admin/users/:id` | Get user details | SUPER_ADMIN, ADMIN |
| `PATCH` | `/admin/users/:id` | Update user info | SUPER_ADMIN, ADMIN |
| `POST` | `/admin/users/:id/activate` | Activate user account | SUPER_ADMIN, ADMIN |
| `POST` | `/admin/users/:id/deactivate` | Deactivate user account | SUPER_ADMIN, ADMIN |
| `POST` | `/admin/users/:id/reset-password` | Reset user password | SUPER_ADMIN, ADMIN |
| `PATCH` | `/admin/users/:id/role` | Change user role | SUPER_ADMIN only |
| `GET` | `/admin/audit-logs` | View audit logs | SUPER_ADMIN, ADMIN |

### Files

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| `POST` | `/files/upload` | Upload and encrypt a file | Required |
| `GET` | `/files` | List own files (paginated) | Required |
| `GET` | `/files/:id` | Get file metadata | Required |
| `GET` | `/files/:id/download` | Download and decrypt file | Required |
| `DELETE` | `/files/:id` | Soft delete a file | Required |

### Users — Self Service

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| `GET` | `/users/me` | Get own profile | Required |
| `PATCH` | `/users/me` | Update own profile | Required |

### Health

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| `GET` | `/health` | Basic health check | Public |
| `GET` | `/health/detailed` | Detailed check (Mongo, Redis, Vault) | Required |

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
| **Rate Limiting** | `@nestjs/throttler` — configurable per-endpoint |
| **HTTP Headers** | Helmet security headers |
| **CORS** | Configurable origin restrictions |
| **Input Validation** | class-validator with whitelist mode (strips unknown fields) |
| **Account Lockout** | 5 failed attempts → 30 min lockout |
| **Audit Trail** | All sensitive operations logged with user, IP, metadata |

---

## Role Hierarchy (RBAC)

The system uses a 5-tier role hierarchy. Higher roles inherit all permissions of lower roles.

```
SUPER_ADMIN (100)  ──  Full system access, can change roles
      │
   ADMIN (80)      ──  User management, audit logs
      │
  MANAGER (60)     ──  Team-level management
      │
  EMPLOYEE (40)    ──  File upload/download, self-service
      │
   VIEWER (20)     ──  Read-only access
```

---

## Environment Variables

See [`.env.example`](.env.example) for the full list. Key variables:

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `NODE_ENV` | No | `development` | `development`, `production`, or `test` |
| `APP_PORT` | No | `3000` | Server port |
| `MONGODB_URI` | **Yes** | — | MongoDB connection string |
| `REDIS_HOST` | No | `localhost` | Redis host |
| `REDIS_PASSWORD` | No | — | Redis password |
| `JWT_ACCESS_SECRET` | **Yes** | — | Min 32 chars |
| `JWT_REFRESH_SECRET` | **Yes** | — | Min 32 chars |
| `VAULT_ENABLED` | No | `false` | Enable HashiCorp Vault |
| `VAULT_TOKEN` | No | — | Vault access token |
| `SEED_SUPER_ADMIN_EMAIL` | No | — | Auto-seed admin on first run |
| `SEED_SUPER_ADMIN_PASSWORD` | No | — | Admin password (min 8 chars) |

---

## All Available Scripts

```bash
# ─── Development ──────────────────────────────────
npm run start:dev          # Start with hot-reload (watch mode)
npm run start:debug        # Start with debugger + hot-reload
npm run start              # Start without hot-reload

# ─── Production ───────────────────────────────────
npm run build              # Compile TypeScript → dist/
npm run start:prod         # Run compiled dist/main.js

# ─── Code Quality ────────────────────────────────
npm run lint               # Run ESLint with auto-fix
npm run format             # Format code with Prettier

# ─── Testing ─────────────────────────────────────
npm run test               # Run unit tests
npm run test:watch         # Run tests in watch mode
npm run test:cov           # Run tests with coverage report
npm run test:debug         # Run tests with debugger
npm run test:e2e           # Run end-to-end tests

# ─── Docker (Infrastructure) ─────────────────────
docker compose up -d       # Start MongoDB, Redis, Vault
docker compose down        # Stop services
docker compose down -v     # Stop + remove all data
docker compose logs -f     # Stream all logs
docker compose ps          # Check service status
```

---

## Project Structure

```
securevault-backend/
├── src/                           # Application source code
│   ├── main.ts                    # Entry point — bootstraps NestJS app
│   ├── app.module.ts              # Root module — wires everything together
│   ├── config/                    # Config loaders + Zod env validation
│   ├── common/                    # Shared filters, interceptors, DTOs
│   ├── shared/                    # Logger, constants, utility functions
│   └── modules/                   # Feature modules (13 total)
│       ├── auth/                  # Authentication (JWT, Passport)
│       ├── users/                 # User management
│       ├── admin/                 # Admin endpoints
│       ├── files/                 # File upload/download + encryption
│       ├── permissions/           # RBAC roles + hierarchy
│       ├── encryption/            # AES-256-GCM envelope encryption
│       ├── vault/                 # HashiCorp Vault integration
│       ├── storage/               # Storage abstraction layer
│       ├── audit/                 # Audit logging
│       ├── queue/                 # BullMQ background processors
│       ├── health/                # Health check endpoints
│       ├── redis/                 # Global Redis client
│       └── database/              # MongoDB connection
├── test/                          # E2E tests
├── storage/                       # File storage (gitignored)
│   ├── uploads/                   # Encrypted file storage
│   └── temp/                      # Temporary processing directory
├── logs/                          # Application logs (gitignored)
├── dist/                          # Compiled output (gitignored)
├── docker-compose.yml             # Dev infrastructure
├── .env.example                   # Environment template
├── .gitignore                     # Git ignore rules
├── tsconfig.json                  # TypeScript configuration
├── package.json                   # Dependencies + scripts
└── README.md                      # This file
```

---

## Troubleshooting

### Docker containers won't start

```bash
# Check if ports are already in use
netstat -ano | findstr "27017 6379 8200"

# Force recreate containers
docker compose up -d --force-recreate
```

### MongoDB authentication failed

Make sure the `MONGODB_URI` in `.env` matches the credentials in `docker-compose.yml`:

```env
# Default docker-compose credentials:
MONGODB_URI=mongodb://securevault_user:securevault_pass_dev@localhost:27017/securevault?authSource=admin
```

### Redis connection failed

Verify the Redis password matches between `.env` and `docker-compose.yml`:

```env
REDIS_PASSWORD=securevault_redis_dev
```

### Environment validation error at startup

The app validates all env vars at boot using Zod. If you see `❌ Environment validation failed`, check the specific field mentioned in the error against `.env.example`.

### JWT secrets too short

Both `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET` must be at least **32 characters**. The app will refuse to start otherwise.

### Vault connection issues

If Vault isn't needed for local development, set:

```env
VAULT_ENABLED=false
```

### Permission errors on storage directories

Make sure the `storage/uploads/`, `storage/temp/`, and `logs/` directories exist and are writable:

```bash
# Windows (PowerShell)
mkdir -Force storage\uploads, storage\temp, logs

# Linux / macOS
mkdir -p storage/uploads storage/temp logs
```

---

## License

UNLICENSED — Private repository
