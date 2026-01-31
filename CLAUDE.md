# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

WhatsApp Blasting SaaS backend - a multi-tenant platform where users subscribe to packages, connect their WhatsApp accounts via QR scan, and send bulk messages with queue-based processing.

## Common Commands

```bash
# Development
npm run start:dev          # Start with hot reload
npm run build              # Compile to dist/
npm run lint               # ESLint with auto-fix
npm run format             # Prettier formatting

# Testing
npm run test               # Run Jest unit tests
npm run test:watch         # Jest watch mode
npm run test:e2e           # End-to-end tests

# Database migrations (requires build first)
npm run migration:generate -- src/database/migrations/MigrationName
npm run migration:run
npm run migration:revert

# Docker
docker-compose up -d --build    # Start dev environment
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
- `whatsapp/` - WhatsApp Web session management via whatsapp-web.js
- `blasts/` - Bulk message campaigns with BullMQ queue processing
- `reports/` - Dashboard stats and CSV exports
- `health/` - System health endpoints

**Core Entities** (`src/database/entities/`):
- User, Package, Payment, Subscription, WhatsAppSession, Blast, BlastMessage

**Shared Infrastructure** (`src/common/`):
- `filters/global-exception.filter.ts` - Standardized error responses
- `interceptors/` - Logging and response transformation
- `dto/api-response.dto.ts` - Standard API response format

## Key Patterns

**Message Processing Pipeline**:
1. User creates blast (validates WhatsApp session + subscription quota)
2. System creates BlastMessage records per phone number
3. Jobs queued to BullMQ with configurable delays
4. `BlastProcessor` handles async sending with retry (3 attempts, exponential backoff)
5. Real-time status updates via WebSocket gateway

**WhatsApp Session**:
- One session per user enforced
- Uses whatsapp-web.js (Puppeteer-based, unofficial API)
- Session persistence in `.wwebjs_auth/` directory
- WebSocket gateway for QR code real-time updates

**Subscription Enforcement**:
- Monthly quota with daily limits
- Auto-deduction on blast start
- Validation before every blast operation

## Configuration

Environment variables configured via `.env` (see `.env.example`):
- `APP_PORT` (default: 2004)
- `DB_*` - PostgreSQL connection
- `REDIS_*` - Redis connection
- `JWT_SECRET`, `JWT_EXPIRES_IN` - Authentication
- `MIDTRANS_*` - Payment gateway

## Development Guidelines

From AGENT.md - always assume:
- Multi-user concurrent sessions
- Failures WILL happen
- Data isolation between users is critical

Never:
- Bypass WhatsApp rate limits
- Suggest unsafe automation tricks
- Assume infinite server resources
