# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

WhatsApp Blasting SaaS backend - a multi-tenant platform where users subscribe to packages, connect their WhatsApp accounts via QR scan or pairing code, and send bulk messages with queue-based processing.

## Common Commands

```bash
# Development
npm run start:dev          # Start with hot reload
npm run build              # Compile to dist/
npm run lint               # ESLint with auto-fix
npm run format             # Prettier formatting

# Testing
npm run test                           # Run all Jest unit tests
npm run test:watch                     # Jest watch mode
npm run test:e2e                       # End-to-end tests
npm run test -- --testPathPattern=auth # Run tests matching pattern
npm run test -- path/to/file.spec.ts   # Run specific test file

# Database migrations (requires build first)
npm run migration:generate -- src/database/migrations/MigrationName
npm run migration:run
npm run migration:revert

# Docker (recommended for development)
docker-compose up -d --build    # Start dev environment (Postgres + Redis + App)
npm run docker:logs             # Follow logs
```

## Architecture

**Framework**: NestJS 11 with TypeORM, PostgreSQL, BullMQ (Redis)

**Entry Point**: `src/main.ts` - Sets up global prefix `/api`, Swagger at `/docs`, validation pipes, exception filters, and interceptors.

**Module Structure** (`src/modules/`):
- `auth/` - JWT authentication with Passport, role-based guards (ADMIN/USER)
- `users/` - User management (Admin CRUD)
- `packages/` - Subscription package definitions
- `payments/` - Midtrans payment gateway integration
- `subscriptions/` - User subscription lifecycle, quota tracking
- `whatsapp/` - WhatsApp session management via Baileys (WebSocket-based), adapter pattern in `adapters/`, WebSocket gateway for real-time events
- `blasts/` - Bulk message campaigns with BullMQ queue processing (`processors/blast.processor.ts`)
- `contacts/` - Contact list management for blast recipients
- `templates/` - Message template management for reusable blast content
- `uploads/` - File uploads with Cloudflare R2 storage and image compression (Sharp)
- `reports/` - Dashboard stats and CSV exports
- `audit/` - Audit logging system for tracking user actions and system events
- `mail/` - Email service using Nodemailer with Handlebars templates
- `notifications/` - In-app notifications with WebSocket delivery and email integration
- `health/` - System health endpoints

**Infrastructure** (`src/`):
- `queue/queue.module.ts` - BullMQ/Redis connection setup
- `config/` - Environment configuration loaders and validation

**Core Entities** (`src/database/entities/`):
- User, Package, Payment, Subscription, WhatsAppSession, Contact, Template, PasswordReset, AuditLog, Notification
- `blast.entity.ts` - Contains both Blast and BlastMessage entities, plus status enums (BlastStatus, MessageStatus, MessageErrorType)
- BlastReply - Stores incoming replies to blast messages

**Database Indexes** (important for query performance):
- `blast_messages`: [blastId, status]
- `blasts`: [userId, status], [userId, createdAt]
- `contacts`: [userId, phoneNumber]
- `notifications`: [userId, isRead], [userId, createdAt]

**Shared Infrastructure** (`src/common/`):
- `filters/global-exception.filter.ts` - Standardized error responses
- `interceptors/` - Logging and response transformation
- `dto/api-response.dto.ts` - Standard API response format

## Key Patterns

**Message Processing Pipeline**:
1. User creates blast (validates WhatsApp session + subscription quota)
2. System creates BlastMessage records per phone number (uses TypeORM transaction for atomicity)
3. `startBlast` deducts quota, queues jobs to BullMQ with configurable delays
4. `BlastProcessor` handles async sending with retry (3 attempts, exponential backoff)
5. Invalid numbers (not on WhatsApp) are detected and skipped without retry
6. Real-time progress updates via WebSocket every 5 messages

**WhatsApp Session**:
- One session per user enforced, max concurrent sessions configurable via `MAX_WA_SESSIONS`
- Uses Baileys (`@whiskeysockets/baileys`) - WebSocket-based, no Puppeteer/Chromium needed
- Adapter pattern: `IWhatsAppClientAdapter` interface with `BaileysAdapter` implementation in `adapters/`
- Session persistence in `.baileys_auth/` directory (uses `useMultiFileAuthState`)
- Supports both QR scan and pairing code connection (`POST /whatsapp/connect-pairing`)
- Auto-disconnect idle sessions after `WA_IDLE_TIMEOUT_MINUTES` (checked every minute)
- Blasting status flag prevents auto-disconnect during active blasts
- WebSocket gateway (`whatsapp.gateway.ts`) at namespace `/whatsapp` emits: `qr`, `status`, `blast-started`, `blast-progress`, `blast-completed`, `blast-reply`, `quota-warning`, `notification`
- Media caching (1 hour TTL) for optimized media sending from local or R2 URLs
- Contact store populated from Baileys events (`contacts.upsert`, `contacts.update`)

**Image Storage Pipeline**:
- Images uploaded via `UploadsModule`, compressed with Sharp
- Stored in Cloudflare R2 (S3-compatible) if configured, else local `uploads/`
- WhatsApp messages can send images directly from R2 URLs

**Subscription Enforcement**:
- Monthly quota with daily limits
- Auto-deduction on blast start
- Validation before every blast operation

**API Response Format**:
All responses wrapped via `TransformInterceptor` using `ApiResponse<T>`:
```json
{ "success": true, "message": "Success", "data": {...}, "timestamp": "..." }
```
Errors use `GlobalExceptionFilter` with standardized codes (BAD_REQUEST, UNAUTHORIZED, etc.)

## Configuration

Environment variables configured via `.env` (see `.env.example`):

**Required:**
- `DB_*` - PostgreSQL connection (use `DB_HOST=postgres` in Docker)
- `REDIS_*` - Redis connection
- `JWT_SECRET`, `JWT_EXPIRES_IN` - Authentication (expires in seconds)
- `MIDTRANS_*` - Payment gateway credentials
- `MAIL_HOST`, `MAIL_PORT`, `MAIL_USER`, `MAIL_PASS` - SMTP configuration

**Optional:**
- `APP_PORT` - Server port (Docker uses 2004, .env.example defaults to 3000)
- `R2_*` - Cloudflare R2 storage (falls back to local `uploads/` if not set)
- `MAX_WA_SESSIONS` - Max concurrent WhatsApp sessions (default: 20)
- `WA_IDLE_TIMEOUT_MINUTES` - Auto-disconnect idle sessions (default: 15)

**API Endpoints:**
- API Base: `http://localhost:{PORT}/api`
- Swagger Docs: `http://localhost:{PORT}/docs`
- Health Check: `http://localhost:{PORT}/api/health`

**Rate Limiting**: Global throttle via `@nestjs/throttler` (100 requests/minute default)

## Development Guidelines

Always assume:
- Multi-user concurrent sessions
- Failures WILL happen (handle WhatsApp disconnects, payment failures)
- Data isolation between users is critical

Never:
- Bypass WhatsApp rate limits
- Suggest unsafe automation tricks
- Assume infinite server resources

## Testing Reference

For manual API testing guide with example requests for Auth, WhatsApp Connect, and Blasting flows, see `testing.md`.
