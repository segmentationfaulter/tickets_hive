# CLAUDE.md

Guidance for Claude Code when working with this repository.

## Project Context

**TicketHive** - Learning project demonstrating high-concurrency ticket booking patterns. Built by a frontend engineer learning backend development.

**Tech Stack**: PostgreSQL, Turborepo monorepo, Native Node.js 24 TypeScript (no transpilation), BullMQ/Redis (Level 3)

**Current Status**: Level 2 complete, Level 3 Milestone 5 complete (optimistic locking in workers)

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
│   ├── services/       # Business logic (bookingService.ts has transaction logic)
│   └── middleware/
├── worker/src/         # Background job processor (bookingProcessor.ts)
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

### Level 2: Pessimistic Locking (Legacy - API only)

**Location**: `apps/api/src/services/bookingService.ts:createBooking()`

Pattern: Transaction with `FOR UPDATE` pessimistic lock
- Guarantees zero overbookings
- Trade-off: Lower throughput, 1-2% timeouts under extreme load (expected)
- Statement timeout: 5 seconds (see `packages/database/src/db.ts`)
- **Note**: Still used by API routes. Will be replaced in Milestone 6 with async queue-based flow.

### Level 3: Optimistic Locking (Workers)

**Location**: `apps/worker/src/processors/bookingProcessor.ts:bookingProcessor()`

Pattern: Version-based optimistic concurrency control
- Read WITHOUT lock → Update WITH version check
- Version conflict triggers BullMQ retry (max 3 attempts)
- No blocking = higher throughput, better scalability
- Trade-off: Occasional retries under high contention (acceptable)
- How it works:
  ```typescript
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

### Level 3 Progress: Milestones 1-5

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
export function createBookingService(db: Database): BookingService {
  return {
    async createBooking(userId: string, payload: CreateBookingPayload) {
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

## Level 3 Plan

**Next**: Milestone 6 (API Migration to Async Queue-Based Processing)

**Goal**: Complete async queue-based architecture with 202 Accepted responses, background workers, optimistic locking

**Completed** (Milestones 1-5):
- ✅ Redis & BullMQ infrastructure
- ✅ Event versioning foundation
- ✅ Job queue architecture with type-safe contracts
- ✅ Worker service with graceful shutdown
- ✅ Optimistic locking implementation in workers

**Remaining** (Milestone 6 for MVP):
- Milestone 6: Migrate API routes to async pattern
  - POST /bookings → 202 Accepted + jobId (instead of 201 Created)
  - GET /bookings/status/:jobId → Poll job progress
  - Update client flow to handle async booking
  - Retire Level 2 pessimistic locking in API

See: `docs/level3/LEVEL_3_MVP_PLAN.md` for detailed implementation guide

## Project Goal

Learning/portfolio project for frontend → backend transition. Focus: concurrency patterns, monorepo architecture, error handling, queue-based processing, Docker orchestration.

Code should be clear, well-commented, demonstrating understanding of backend patterns.
