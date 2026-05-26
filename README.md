# SecureVault — Enterprise Secure File Sharing Platform

> Production-grade secure file-sharing backend built with NestJS, TypeScript, MongoDB, Redis, and HashiCorp Vault.

## Features

- **Authentication & Authorization** — JWT-based auth with access/refresh token rotation, token blacklisting via Redis
- **Role-Based Access Control (RBAC)** — 5-tier hierarchy: SUPER_ADMIN → ADMIN → MANAGER → EMPLOYEE → VIEWER
- **Envelope Encryption** — AES-256-GCM with per-file DEKs encrypted by a Vault-managed KEK
- **HashiCorp Vault Integration** — Secrets management and encryption key storage
- **Encrypted File Storage** — Files encrypted at rest with integrity verification (SHA-256 checksums)
- **Admin User Management** — Create accounts, assign roles, force password resets, activate/deactivate users
- **Comprehensive Audit Logging** — Every sensitive operation is tracked with user, IP, and metadata
- **Rate Limiting** — Configurable rate limits via @nestjs/throttler
- **API Documentation** — Auto-generated Swagger/OpenAPI docs
- **Background Processing** — Queue module for async audit logging and file cleanup tasks
- **Health Checks** — System health endpoints for monitoring

## Architecture

```
src/
├── main.ts                    # Bootstrap with Helmet, CORS, Swagger
├── app.module.ts              # Root module wiring
├── config/                    # Environment config (Zod-validated)
├── common/                    # Shared filters, interceptors, DTOs
├── shared/                    # Logger, constants, crypto/file utils
└── modules/
    ├── auth/                  # JWT auth, strategies, guards, decorators
    ├── users/                 # User CRUD, schema, password management
    ├── admin/                 # Admin user management, audit viewing
    ├── files/                 # File upload/download with encryption
    ├── permissions/           # RBAC roles, hierarchy, permissions
    ├── encryption/            # AES-256-GCM envelope encryption
    ├── vault/                 # HashiCorp Vault integration
    ├── storage/               # Storage abstraction (local, S3-ready)
    ├── audit/                 # Audit logging with structured events
    ├── queue/                 # Background processors (audit, files)
    ├── health/                # Health check endpoints
    └── database/              # MongoDB connection module
```

## Prerequisites

- **Node.js** ≥ 20.x
- **Docker & Docker Compose** (for MongoDB, Redis, Vault)
- **pnpm** or **npm**

## Quick Start

### 1. Clone and Install

```bash
cd securevault-backend
npm install
```

### 2. Start Infrastructure

```bash
docker-compose up -d
```

This starts:
- **MongoDB 7** on `localhost:27017`
- **Redis 7** on `localhost:6379`
- **HashiCorp Vault** (dev mode) on `localhost:8200`

### 3. Configure Environment

```bash
cp .env.example .env
# Edit .env with your values (JWT secrets, database URI, etc.)
```

> **Important:** JWT secrets must be at least 32 characters.

### 4. Run the Application

```bash
# Development (with hot-reload)
npm run start:dev

# Production
npm run build
npm run start:prod
```

### 5. Access the API

- **API Base:** `http://localhost:3000/api/v1`
- **Swagger Docs:** `http://localhost:3000/docs`
- **Health Check:** `http://localhost:3000/api/v1/health`

## API Endpoints

### Authentication
| Method | Endpoint | Description | Access |
|--------|----------|-------------|--------|
| POST | `/auth/login` | Login | Public |
| POST | `/auth/refresh` | Refresh token | Public |
| POST | `/auth/logout` | Logout | Authenticated |
| POST | `/auth/change-password` | Change password | Authenticated |
| POST | `/auth/force-change-password` | First-login password change | Authenticated |

### Admin (User Management)
| Method | Endpoint | Description | Access |
|--------|----------|-------------|--------|
| POST | `/admin/users` | Create user | SUPER_ADMIN, ADMIN |
| GET | `/admin/users` | List users | SUPER_ADMIN, ADMIN |
| GET | `/admin/users/:id` | Get user | SUPER_ADMIN, ADMIN |
| PATCH | `/admin/users/:id` | Update user | SUPER_ADMIN, ADMIN |
| POST | `/admin/users/:id/activate` | Activate | SUPER_ADMIN, ADMIN |
| POST | `/admin/users/:id/deactivate` | Deactivate | SUPER_ADMIN, ADMIN |
| POST | `/admin/users/:id/reset-password` | Reset password | SUPER_ADMIN, ADMIN |
| PATCH | `/admin/users/:id/role` | Change role | SUPER_ADMIN |
| GET | `/admin/audit-logs` | View audit logs | SUPER_ADMIN, ADMIN |

### Files
| Method | Endpoint | Description | Access |
|--------|----------|-------------|--------|
| POST | `/files/upload` | Upload file | Authenticated |
| GET | `/files` | List files | Authenticated |
| GET | `/files/:id` | File metadata | Authenticated |
| GET | `/files/:id/download` | Download file | Authenticated |
| DELETE | `/files/:id` | Soft delete | Authenticated |

### Users (Self-Service)
| Method | Endpoint | Description | Access |
|--------|----------|-------------|--------|
| GET | `/users/me` | Get profile | Authenticated |
| PATCH | `/users/me` | Update profile | Authenticated |

### Health
| Method | Endpoint | Description | Access |
|--------|----------|-------------|--------|
| GET | `/health` | Basic check | Public |
| GET | `/health/detailed` | Full system check | Authenticated |

## Security

- **Passwords:** bcrypt with 12 salt rounds
- **JWT:** 15-minute access tokens, 7-day refresh tokens with rotation
- **Token Blacklisting:** Redis-backed revocation
- **File Encryption:** AES-256-GCM per-file DEKs, Vault-managed KEK
- **Rate Limiting:** Configurable per-endpoint throttling
- **Headers:** Helmet security headers
- **CORS:** Configurable origin restrictions
- **Input Validation:** class-validator with whitelist mode
- **Audit Trail:** All sensitive operations logged

## Environment Variables

See `.env.example` for all available configuration options.

## Scripts

```bash
npm run start:dev       # Development mode with hot-reload
npm run build           # Build for production
npm run start:prod      # Run production build
npm run lint            # Lint code
npm run format          # Format code with Prettier
npm run test            # Run unit tests
npm run test:e2e        # Run end-to-end tests
```

## License

UNLICENSED — Private repository
