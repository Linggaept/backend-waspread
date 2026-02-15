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
npm run test:cov                       # Run tests with coverage report
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
- `auth/` - JWT authentication with Passport, role-based guards (ADMIN/USER), feature-based guards (`FeatureGuard` for subscription feature access)
- `users/` - User management (Admin CRUD)
- `packages/` - Subscription package definitions
- `payments/` - Midtrans payment gateway integration
- `subscriptions/` - User subscription lifecycle, quota tracking
- `whatsapp/` - WhatsApp session management via Baileys (WebSocket-based), adapter pattern in `adapters/`, WebSocket gateway for real-time events
- `blasts/` - Bulk message campaigns with BullMQ queue processing (`processors/blast.processor.ts`)
- `chats/` - Conversation management with full message history, bidirectional messaging, and blast campaign linking
- `copywriting/` - AI-powered marketing message generation using Google Gemini (multi-tone, multi-variation)
- `ai/` - AI-powered reply suggestions with knowledge base (per-user business context, tone settings, keyword-based retrieval). Sub-services: `AiTokenService` (token balance), `AiTokenPricingService` (dynamic pricing), `AutoReplyService` (auto-reply orchestration)
- `contacts/` - Contact list management for blast recipients
- `templates/` - Message template management for reusable blast content
- `uploads/` - File uploads with Cloudflare R2 storage and image compression (Sharp)
- `reports/` - Dashboard stats and CSV exports
- `audit/` - Audit logging system for tracking user actions and system events
- `mail/` - Email service using Nodemailer with Handlebars templates
- `notifications/` - In-app notifications with WebSocket delivery and email integration
- `health/` - System health endpoints
- `leads/` - Lead scoring system with BullMQ queue processing (`leads.processor.ts`)
- `followups/` - Automated followup campaigns triggered by blast responses or funnel stages, with multi-step message sequences and scheduling (`followup.processor.ts`, `contact-followup.processor.ts`)
- `analytics/` - Conversation funnel tracking, analytics snapshots, and closing insights
- `products/` - Product catalog management
- `settings/` - User settings management

**Infrastructure** (`src/`):
- `queue/queue.module.ts` - BullMQ/Redis connection setup (queues: `blast`, `leads`, `followup`, `contact-followup`, `auto-reply`)
- `config/` - Environment configuration loaders and validation
- `database/data-source.ts` - TypeORM data source for migrations

**Core Entities** (`src/database/entities/`):
- User, Package, Payment, Subscription, WhatsAppSession, Contact, Template, PasswordReset, AuditLog, Notification
- `blast.entity.ts` - Contains both Blast and BlastMessage entities, plus status enums (BlastStatus, MessageStatus, MessageErrorType)
- BlastReply - Stores incoming replies to blast messages
- ChatMessage - Full conversation history with direction (incoming/outgoing), optional blast linking, read status
- AiSettings - Per-user AI configuration (tone, business context, enabled state, auto-reply settings)
- AiKnowledgeBase - User's knowledge entries for AI context (categories: product, faq, promo, policy, custom)
- AiTokenPackage - Purchasable AI token packages with bonus tokens
- AiTokenPricing - Dynamic pricing configuration (divisor, markup, minimum charge per feature)
- AiTokenUsage - Tracks token consumption per feature (auto_reply, auto_reply_image, suggest, copywriting, etc.)
- AiTokenPurchase - Purchase history for AI token packages
- AutoReplyLog - Logs of auto-reply attempts with status (queued/sent/failed/skipped)
- AutoReplyBlacklist - Phone numbers excluded from auto-reply per user
- LeadScore - Lead scoring per phone number (hot/warm/cold), tracks keyword matches, response time, engagement
- LeadScoreSettings - Configurable scoring thresholds per user
- ConversationFunnel - Tracks leads through stages: blast_sent → delivered → replied → interested → negotiating → closed_won/lost
- AnalyticsSnapshot - Periodic analytics snapshots for trend tracking
- Product - Product catalog entries for users
- ChatConversation - Denormalized conversation summaries for fast list rendering
- PinnedConversation - User-pinned conversations
- UserSettings - Per-user preferences
- FollowupCampaign - Automated followup campaign configurations with trigger conditions and message sequences
- FollowupMessage - Individual scheduled followup messages
- ContactFollowup - Per-contact followup tracking and status

**Database Indexes** (important for query performance):
- `blast_messages`: [blastId, status]
- `blasts`: [userId, status], [userId, createdAt]
- `contacts`: [userId, phoneNumber]
- `notifications`: [userId, isRead], [userId, createdAt]
- `chat_messages`: [userId, phoneNumber, timestamp], [userId, phoneNumber], [userId, timestamp], unique on [whatsappMessageId] where not null
- `ai_knowledge_base`: [userId, isActive], [userId, category]
- `lead_scores`: [userId, score], [userId, lastInteraction]
- `conversation_funnels`: [userId, currentStage], [userId, blastId], unique on [userId, phoneNumber]

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
- WebSocket gateway (`whatsapp.gateway.ts`) at namespace `/whatsapp` emits: `qr`, `status`, `blast-started`, `blast-progress`, `blast-completed`, `blast-reply`, `quota-warning`, `notification`, `chat:message`, `chat:message-sent`
- Media caching (1 hour TTL) for optimized media sending from local or R2 URLs
- Contact store populated from Baileys events (`contacts.upsert`, `contacts.update`)
- Message store handler pattern: `ChatsModule` registers itself to receive all incoming/outgoing messages for persistence

**Image Storage Pipeline**:
- Images uploaded via `UploadsModule`, compressed with Sharp
- Stored in Cloudflare R2 (S3-compatible) if configured, else local `uploads/`
- WhatsApp messages can send images directly from R2 URLs

**Subscription Enforcement**:
- Monthly quota with daily limits
- Auto-deduction on blast start
- Validation before every blast operation

**Chat-Blast Integration**:
- Outgoing blast messages automatically stored in ChatMessage with `blastId` reference
- Incoming replies linked to original campaign via BlastMessage lookup
- Conversation view groups all messages (blast + manual) by phone number
- Real-time WebSocket updates for both directions

**AI Copywriting** (optional, requires `GEMINI_API_KEY`):
- Generates 1-5 WhatsApp marketing message variations from a prompt
- Tone options: FRIENDLY, URGENT, PROFESSIONAL, CASUAL, EXCITED
- Uses different persuasion techniques per variation (scarcity, social proof, benefit-focused, etc.)
- Optimized for 50-300 character messages

**AI Reply Suggestions** (optional, requires `GEMINI_API_KEY`):
- Per-user knowledge base with categories (product, faq, promo, policy, custom)
- Keyword-based retrieval from knowledge entries to provide context
- Uses last 5 chat messages for conversation context
- Tone settings: FORMAL, CASUAL, FRIENDLY
- Business name/description configurable per user
- Bulk import knowledge via Excel/CSV (columns: title, content, category, keywords)
- Returns 3 suggested replies per request

**AI Token System**:
- Separate purchasable AI token balance (independent from subscription message quota)
- Token packages with bonus tokens for larger purchases, paid via Midtrans
- Dynamic pricing: Gemini API tokens converted to platform tokens via divisor + markup
- Feature-specific token costs: auto_reply (1), auto_reply_image (3), copywriting (2), suggest (1), analytics (3)
- Subscription packages can include bonus AI tokens
- Decimal token amounts supported for fine-grained pricing

**Auto-Reply** (requires AI tokens):
- Automated AI-powered replies to incoming WhatsApp messages
- Supports both text and image messages (vision-based analysis)
- Configurable: working hours, delay range (min/max seconds), cooldown per contact
- Blacklist support to exclude specific phone numbers
- Fallback message when AI fails or tokens exhausted
- Processed via BullMQ queue (`auto-reply`) for async execution
- Status tracking: QUEUED → SENT/FAILED/SKIPPED
- WebSocket events: `auto-reply:sent`, `auto-reply:skipped`

**Lead Scoring**:
- Automatic scoring based on keyword matches (configurable per user), response time, engagement, and recency
- Three levels: HOT, WARM, COLD with configurable thresholds
- Processed via BullMQ queue (`leads` queue) for async calculation
- Manual override supported with reason tracking

**Conversation Funnel Tracking**:
- Stages: BLAST_SENT → DELIVERED → REPLIED → INTERESTED → NEGOTIATING → CLOSED_WON/CLOSED_LOST
- Auto-progression via keyword detection (e.g., "beli", "order" → INTERESTED)
- Deal value tracking for closed deals
- AI-powered closing insights with success/failure factors

**Automated Followup Campaigns**:
- Trigger-based: NO_REPLY, STAGE_REPLIED, STAGE_INTERESTED, STAGE_NEGOTIATING
- Multi-step message sequences with configurable delays (hours)
- Per-contact tracking via ContactFollowup entity
- Scheduler service checks pending followups and queues them for processing
- Integrates with chat system for message persistence and WebSocket delivery
- Skips contacts who have already replied or progressed in funnel

**API Response Format**:
All responses wrapped via `TransformInterceptor` using `ApiResponse<T>`:
```json
{ "success": true, "message": "Success", "data": {...}, "timestamp": "..." }
```
Errors use `GlobalExceptionFilter` with standardized codes (BAD_REQUEST, UNAUTHORIZED, etc.)

## Configuration

Environment variables configured via `.env` (see `.env.example`):

**Required:**
- `DB_*` - PostgreSQL connection (use `DB_HOST=postgres` in Docker, set `DB_SSL=true` for production)
- `REDIS_*` - Redis connection
- `JWT_SECRET`, `JWT_EXPIRES_IN` - Authentication (expires in seconds)
- `MIDTRANS_*` - Payment gateway credentials (`MIDTRANS_IS_PRODUCTION=false` for sandbox)
- `MAIL_HOST`, `MAIL_PORT`, `MAIL_USER`, `MAIL_PASS` - SMTP configuration

**Optional:**
- `APP_PORT` - Server port (Docker uses 2004, .env.example defaults to 3000)
- `LOG_LEVEL` - Logging level (default: debug in development, limited in production)
- `R2_*` - Cloudflare R2 storage (falls back to local `uploads/` if not set)
- `MAX_WA_SESSIONS` - Max concurrent WhatsApp sessions (default: 40)
- `WA_IDLE_TIMEOUT_MINUTES` - Auto-disconnect idle sessions (default: 15)
- `GEMINI_API_KEY` - Google Gemini API key for AI copywriting (feature disabled if not set)
- `GEMINI_MODEL` - Gemini model name (default: `gemini-2.0-flash`)
- `WA_SYNC_FULL_HISTORY` - Sync all WhatsApp history (default: false, WARNING: high memory)
- `WA_SYNC_HISTORY_DAYS` - Days of history to sync (default: 7)
- `CHAT_MESSAGE_RETENTION_DAYS` - Auto-delete old messages (default: 30, 0 to disable)
- `CHAT_CLEANUP_INTERVAL_HOURS` - Cleanup job interval (default: 24)

**API Endpoints:**
- API Base: `http://localhost:{PORT}/api`
- Swagger Docs: `http://localhost:{PORT}/docs` (disabled in production)
- Health Check: `http://localhost:{PORT}/api/health`

**Rate Limiting**: Global throttle via `@nestjs/throttler` (100 requests/minute default)

**Backup Configuration** (optional):
- `DAILY_RETENTION` - Days to keep daily backups (default: 7)
- `WEEKLY_RETENTION` - Weeks to keep weekly backups (default: 4)
- `MONTHLY_RETENTION` - Months to keep monthly backups (default: 3)
- `BACKUP_ALERT_EMAIL` - Email for backup alerts
- `BACKUP_ALERT_WEBHOOK` - Webhook URL for backup alerts

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
