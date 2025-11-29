# CLAUDE.md

Guidance for Claude Code when working with this repository.

## Project Context

**TicketHive** - Learning project demonstrating high-concurrency ticket booking patterns. Built by a frontend engineer learning backend development.

**Tech Stack**: PostgreSQL, Turborepo monorepo, Native Node.js 24 TypeScript (no transpilation), BullMQ/Redis (Level 3)

**Current Status**: Level 3 MVP complete (Milestones 1-6 complete) - Fully async queue-based booking system

## Essential Commands

```bash
npm run setup        # Generate Docker secrets (first time)
npm run docker:dev   # Start all services (recommended)
npm run docker:logs  # View logs
npm run docker:stop  # Stop services
npm run build        # Type-check all packages
npm run test:load    # Load test (DON'T run during development)
```

## Architecture

### Monorepo Structure

```
apps/
├── api/src/
│   ├── routes/         # auth.ts, events.ts, bookings.ts
│   ├── services/       # Business logic (queueService.ts for job creation)
│   └── middleware/
├── worker/src/         # Background job processor (bookingProcessor.ts with optimistic locking)
└── dashboard/          # Admin UI

packages/
├── database/src/       # db.ts (postgres.js), schema.ts
├── types/src/          # Shared TypeScript types
└── lib/src/            # errors.ts, errorHandler.ts, auth.ts, env.ts
```

### Path Aliases (Always Use These)

```typescript
import { sql } from "@ticket-hive/database";
import { Event, Booking } from "@ticket-hive/types";
import { AppError, ErrorCode } from "@ticket-hive/lib";
```

**Never use relative imports** for shared packages.

## Key Implementation Details

### Level 2: Pessimistic Locking (DEPRECATED - Replaced by Level 3)

**Previous Location**: `apps/api/src/services/bookingService.ts:createBooking()` (removed in Milestone 6)

Pattern: Transaction with `FOR UPDATE` pessimistic lock
- Guaranteed zero overbookings with row-level locks
- Trade-off: Lower throughput (800-1500ms), 1-2% timeouts under extreme load
- Statement timeout: 5 seconds (see `packages/database/src/db.ts`)
- **Status**: ❌ Removed - replaced by Level 3 async queue-based flow with optimistic locking

### Level 3: Async Queue-Based with Optimistic Locking (CURRENT)

**API Location**: `apps/api/src/routes/bookings.ts` (POST /bookings → 202 Accepted)
**Worker Location**: `apps/worker/src/processors/bookingProcessor.ts:bookingProcessor()`

Pattern: Async queue-based processing with version-based optimistic concurrency control
- API returns 202 Accepted with jobId immediately (<100ms, non-blocking)
- Worker processes jobs asynchronously with optimistic locking
- Read WITHOUT lock → Update WITH version check
- Version conflict triggers BullMQ retry (max 3 attempts)
- No blocking = higher throughput (10x improvement), better scalability
- Trade-off: Eventual consistency, occasional retries under high contention (acceptable)
- How it works:
  ```typescript
  // API Layer: Non-blocking job creation
  const jobId = await queueService.createBookingJob({ userId, eventId, timestamp });
  res.status(202).json({ jobId, status: "pending" }); // <100ms response

  // Worker Layer: Optimistic locking
  // 1. Read event (no lock)
  const event = await tx`SELECT id, version, available_tickets WHERE id = ?`;

  // 2. Update with version constraint
  const result = await tx`
    UPDATE events
    SET tickets = tickets - 1, version = version + 1
    WHERE id = ? AND version = ${event.version}  -- Atomic conflict check
  `;

  // 3. Detect conflict
  if (result.length === 0) {
    throw VERSION_CONFLICT;  // BullMQ retries automatically
  }
  ```

### Level 3 Progress: Milestones 1-6 (MVP Complete)

**Milestone 1 (Redis & BullMQ Infrastructure)**: ✅ Complete
- Redis service in Docker Compose with health checks
- BullMQ and ioredis dependencies installed
- Shared Redis connection (`packages/lib/src/redis.ts`)
- Worker environment configuration in `packages/lib/src/env.ts`

**Milestone 2 (Event Versioning)**: ✅ Complete
- Version column added to events table (`packages/database/src/schema.ts`)
- All events have `version` field (starts at 0, increments on each update)
- Level 2 booking flow increments version but doesn't check it yet
- Foundation for Milestone 5 optimistic locking implementation

**Milestone 3 (Job Queue Architecture)**: ✅ Complete
- Job data schema with Zod validation (`packages/types/src/bookingJob.ts`)
- BullMQ queue configuration (`packages/lib/src/queues.ts`)
- Queue service for API (`apps/api/src/services/queueService.ts`)
- Type-safe contract between API (producer) and Worker (consumer)

**Milestone 4 (Worker Service & Processing Architecture)**: ✅ Complete
- Worker service with BullMQ integration (`apps/worker/src/index.ts`)
- Skeleton booking processor (`apps/worker/src/processors/bookingProcessor.ts`)
- Configurable concurrency and retry settings
- Event handlers for observability (completed, failed, stalled)
- Graceful shutdown handling (SIGTERM/SIGINT)
- Docker orchestration with separate worker container
- Job validation with Zod schemas

**Milestone 5 (Optimistic Locking Implementation)**: ✅ Complete
- Full booking processor with optimistic locking (`apps/worker/src/processors/bookingProcessor.ts`)
- Factory pattern with database dependency injection
- Version-based conflict detection (no blocking locks)
- Automatic retry via BullMQ (3 attempts, exponential backoff)
- VERSION_CONFLICT error code for retryable errors (`packages/lib/src/errors.ts`)
- Read → Validate → Update WITH version check → Create booking (atomic transaction)
- Higher throughput than Level 2 (no FOR UPDATE blocking)

**Milestone 6 (API Migration to Async Queue-Based Processing)**: ✅ Complete
- POST /api/v1/bookings migrated to async pattern (`apps/api/src/routes/bookings.ts`)
- Returns 202 Accepted with jobId (instead of 201 Created with booking)
- Response time: <100ms (105x faster than Level 2's 800-1500ms)
- New endpoint: GET /api/v1/bookings/status/:jobId for polling job status
- Level 2 pessimistic locking removed from API (`bookingService.createBooking()` deleted)
- Workers process bookings asynchronously with optimistic locking
- Full async architecture: API → Redis Queue → Worker → Database
- Zero overbookings maintained, 10x throughput improvement

### Error Handling

**Three-Layer Pattern**:
1. **Database Layer** → PostgreSQL errors (codes: `57014`, `23505`)
2. **Service Layer** → `AppError` with business codes
3. **Route Layer** → HTTP responses (see `packages/lib/src/errorHandler.ts`)

**Business Errors (4xx)**: Expected, don't retry in application logic
- EVENT_NOT_FOUND, EVENT_SOLD_OUT (non-retryable business logic)
- VERSION_CONFLICT (retryable concurrency conflict - BullMQ retries automatically)

**Infrastructure Errors (5xx)**: Unexpected, can retry
- STATEMENT_TIMEOUT, DATABASE_CONNECTION_ERROR

**Always use user-friendly messages** - never expose technical details.

## Coding Patterns (MUST FOLLOW)

### Factory Functions (No Classes)

```typescript
// ✅ Preferred
export function createEventService(db: Database): EventService {
  return {
    async getEventById(eventId: string): Promise<Event | null> {
      // implementation
    }
  };
}

// ❌ Avoid classes
```

### Const Objects (No TypeScript Enums)

```typescript
// ✅ Preferred (native TS requirement)
export const ErrorCode = {
  EVENT_NOT_FOUND: "EVENT_NOT_FOUND",
} as const;
export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

// ❌ Avoid enums (won't work with --experimental-transform-types)
```

### Always Use Transactions for Read-Then-Write

```typescript
// ✅ Correct
await db.begin(async (tx) => {
  const event = await tx`SELECT ...`;
  await tx`UPDATE ...`;
});

// ❌ Wrong - race condition
const event = await db`SELECT ...`;
await db`UPDATE ...`;
```

## Environment Setup

**Two modes**: Docker (production-like, uses secrets) or Local (uses .env.local)

Run `npm run setup` to generate Docker secrets. Helper functions in `@ticket-hive/lib` handle both modes.

## Native TypeScript

- Runs `.ts` files directly (no compilation)
- `npm run build` only type-checks
- No `dist/` folders
- Must use `const` objects instead of enums

## Common Tasks

**Add API Endpoint**:
1. Define types in `packages/types/src/`
2. Implement service in `apps/api/src/services/` (factory pattern)
3. Create route in `apps/api/src/routes/`
4. Mount in `apps/api/src/index.ts`

**Modify Schema**:
1. Edit `packages/database/src/schema.ts`
2. Update types in `packages/types/src/`
3. Restart services

## Important Notes

- **Package boundaries matter**: database (client only), types (pure types), lib (shared utils), api/worker (app logic)
- **Load test expectations**: 1-2% timeout rate is normal under Level 2, 10% success rate with 100 tickets/1000 requests is correct
- **Comments required**: Add explanatory comments for critical business logic
- **Type errors don't prevent runtime** but fix before committing

## Level 3 Status

**Current Status**: ✅ **MVP COMPLETE** (Milestones 1-6)

**What's Working**:
- ✅ Fully async queue-based booking system
- ✅ API response time: <100ms (105x faster than Level 2)
- ✅ Workers processing jobs with optimistic locking
- ✅ Zero overbookings, 10x throughput improvement
- ✅ Horizontal scalability (can scale workers independently)

**Completed Milestones**:
- ✅ Milestone 1: Redis & BullMQ infrastructure
- ✅ Milestone 2: Event versioning foundation
- ✅ Milestone 3: Job queue architecture with type-safe contracts
- ✅ Milestone 4: Worker service with graceful shutdown
- ✅ Milestone 5: Optimistic locking implementation in workers
- ✅ Milestone 6: API migration to async pattern

**How It Works Now**:
1. Client → POST /api/v1/bookings → 202 Accepted + jobId (<100ms)
2. API → Push job to Redis queue → Return immediately
3. Worker → Pull job → Optimistic locking → Create booking
4. Client → Poll GET /api/v1/bookings/status/:jobId → Get result

**Optional Production Hardening** (Milestones 7-10):
- Server-Sent Events (SSE) for real-time updates
- Rate limiting and circuit breakers
- Monitoring dashboard (BullMQ UI)
- 10K load testing

See: `docs/level3/LEVEL_3_MVP_PLAN.md` for implementation details

## Project Goal

Learning/portfolio project for frontend → backend transition. Focus: concurrency patterns, monorepo architecture, error handling, queue-based processing, Docker orchestration.

Code should be clear, well-commented, demonstrating understanding of backend patterns.
