# CLAUDE.md

Guidance for Claude Code when working with this repository.

## Project Context

**TicketHive** - Learning project demonstrating high-concurrency ticket booking patterns. Built by a frontend engineer learning backend development.

**Tech Stack**: PostgreSQL, Turborepo monorepo, Native Node.js 24 TypeScript (no transpilation), BullMQ/Redis (Level 3)

**Current Status**: Level 2 complete (pessimistic locking), Level 3 in progress (async queue-based)

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
├── worker/src/         # Background jobs (Level 3 - empty for now)
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

### Level 2: Pessimistic Locking

**Location**: `apps/api/src/services/bookingService.ts:createBooking()`

Pattern: Transaction with `FOR UPDATE` pessimistic lock
- Guarantees zero overbookings
- Trade-off: Lower throughput, 1-2% timeouts under extreme load (expected)
- Statement timeout: 5 seconds (see `packages/database/src/db.ts`)

### Error Handling

**Three-Layer Pattern**:
1. **Database Layer** → PostgreSQL errors (codes: `57014`, `23505`)
2. **Service Layer** → `AppError` with business codes
3. **Route Layer** → HTTP responses (see `packages/lib/src/errorHandler.ts`)

**Business Errors (4xx)**: Expected, don't retry (EVENT_NOT_FOUND, EVENT_SOLD_OUT)
**Infrastructure Errors (5xx)**: Unexpected, can retry (STATEMENT_TIMEOUT, DATABASE_CONNECTION_ERROR)

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

Next: Milestone 1 (Redis & BullMQ infrastructure)

Goal: Async queue-based architecture with 202 Accepted responses, background workers, SSE for status updates, optimistic locking

See: `docs/level3/LEVEL_3_COMPLETE_PLAN.md` for complete roadmap

## Project Goal

Learning/portfolio project for frontend → backend transition. Focus: concurrency patterns, monorepo architecture, error handling, queue-based processing, Docker orchestration.

Code should be clear, well-commented, demonstrating understanding of backend patterns.
