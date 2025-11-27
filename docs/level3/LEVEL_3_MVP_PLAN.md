# TicketHive Level 3 MVP Implementation Plan

## 🎯 Goal: Async Queue-Based Processing (Core Functionality)

**This is Part 1 of Level 3 - MVP (Minimum Viable Product)**

**What You'll Build**: A working async booking system using BullMQ queues and Redis. After completing this MVP, you'll have:
- API returning 202 Accepted in <100ms
- Background workers processing bookings asynchronously
- Optimistic locking preventing race conditions
- 10x throughput improvement vs Level 2
- **A fully demo-able system for your portfolio**

**What's Deferred to Production Phase**: SSE status updates, rate limiting, circuit breakers, monitoring dashboard, and 10K load testing.

---

## 📋 Architecture Overview (MVP)

```
┌─────────────┐      1. POST /book      ┌────────────────────┐
│             │ ──────────────────────► │                    │
│   Client    │    (with payload)       │  API Service       │
│             │                         │  (/apps/api)       │
└──────┬──────┘                         └───────────┬────────┘
       │                                           │
       │                                           │ 2. Validate with Zod
       │                                           │ 3. Create booking job
       │                                           │ 4. Return 202 + jobId (<100ms)
       │                                           │
       │ ◄─────────────────────────────────────────┤
       │                                           │ 5. Push to BullMQ Queue
       │                                           ▼
       │                                 ┌────────────────────┐
       │                                 │   Redis            │
       │                                 │   - Job queue      │
       │                                 │   - Job persistence│
       │                                 └───────────┬────────┘
       │                                           │
       │                                           │ 6. Worker pulls job
       │                                           ▼
       │                                 ┌────────────────────┐
       │                                 │ Worker Service     │
       │                                 │ (/apps/worker)     │
       │                                 └───────────┬────────┘
       │                                           │
       │                                           │ 7. Optimistic locking
       │                                           │    (version check)
       │                                           │ 8. Database update
       │                                           ▼
       │                                 ┌────────────────────┐
       │                                 │ PostgreSQL         │
       │                                 │                    │
       │                                 └────────────────────┘

/packages
  /database  (Shared PostgreSQL client)
  /types     (Shared Zod schemas + TS types)
  /lib       (Shared utilities, errors, Redis client)
```

**MVP Simplifications**:
- No SSE implementation yet (clients poll for status or wait for worker completion)
- No rate limiting (will add in Production phase)
- No circuit breakers (will add in Production phase)
- No monitoring dashboard (will add in Production phase)
- Basic error handling (comprehensive handling in Production phase)

---

## 🛣️ MVP Milestones (0-6)

### **Milestone 0: Monorepo Restructure** ✅ COMPLETE

**Status**: ✅ **COMPLETE** - Your monorepo restructure is solid!

**What You Built**:
- ✅ `/apps/api/` with full Level 2 implementation
- ✅ `/apps/worker/` structure (empty, ready for M4)
- ✅ `/packages/database/`, `/packages/types/`, `/packages/lib/`
- ✅ Turborepo build system working
- ✅ TypeScript path aliases configured
- ✅ Docker Compose updated for monorepo
- ✅ Native Node.js 24 TypeScript execution

**Verification Passed**:
```bash
npm run build  # ✅ 5 packages, 0 errors
```

**Next**: Proceed to Milestone 1 (Redis infrastructure)

---

### **Milestone 1: Infrastructure Setup - Redis & BullMQ Foundation**

**Objective**: Add Redis service and BullMQ dependencies to enable queue-based processing.

**Tasks**:

1. **Docker Compose Updates**
   ```yaml
   # Add to compose.yaml
   redis:
     image: redis:7-alpine
     ports:
       - "6379:6379"
     volumes:
       - redis_data:/data
     healthcheck:
       test: ["CMD", "redis-cli", "ping"]
       interval: 5s
       timeout: 3s
       retries: 5

   # Add to volumes section
   volumes:
     postgres_data:
     redis_data:  # Add this
   ```

2. **Package Dependencies**
   ```bash
   # In root directory
   npm install bullmq ioredis
   npm install -D @types/ioredis
   ```

3. **Environment Configuration**

   Update `packages/lib/src/env.ts`:
   ```typescript
   import { createEnv } from "@t3-oss/env-core";
   import { z } from "zod";

   export const env = createEnv({
     server: {
       // ... existing PostgreSQL, JWT config

       // Redis configuration
       REDIS_HOST: z.string().default("localhost"),
       REDIS_PORT: z.coerce.number().default(6379),
       REDIS_PASSWORD: z.string().optional(),

       // Worker configuration (MVP: simple values)
       WORKER_CONCURRENCY: z.coerce.number().default(5),
       WORKER_MAX_RETRIES: z.coerce.number().default(3),
       WORKER_RETRY_DELAY_MS: z.coerce.number().default(100),
     },
     runtimeEnv: process.env,
   });
   ```

4. **Redis Connection Setup**

   Create `packages/lib/src/redis.ts`:
   ```typescript
   import { Redis } from "ioredis";
   import { env } from "./env.js";

   /**
    * Shared Redis connection for BullMQ
    *
    * BullMQ requires ioredis (not node-redis) for connection handling.
    * This creates a singleton connection used by both queues and workers.
    */
   export const redis = new Redis({
     host: env.REDIS_HOST,
     port: env.REDIS_PORT,
     password: env.REDIS_PASSWORD,
     maxRetriesPerRequest: null, // Required for BullMQ
     retryStrategy(times) {
       const delay = Math.min(times * 50, 2000);
       return delay;
     },
   });

   // Graceful shutdown
   process.on("SIGTERM", async () => {
     await redis.quit();
   });
   ```

   Update `packages/lib/src/index.ts`:
   ```typescript
   export * from "./errors.js";
   export * from "./errorHandler.js";
   export * from "./auth.js";
   export * from "./env.js";
   export * from "./redis.js";  // Add this
   ```

5. **Update Environment Files**

   Add to `.env.docker`:
   ```env
   # Redis Configuration
   REDIS_HOST=redis
   REDIS_PORT=6379

   # Worker Configuration
   WORKER_CONCURRENCY=5
   WORKER_MAX_RETRIES=3
   WORKER_RETRY_DELAY_MS=100
   ```

   Add to `.env.example`:
   ```env
   # Redis
   REDIS_HOST=localhost
   REDIS_PORT=6379
   REDIS_PASSWORD=

   # Worker
   WORKER_CONCURRENCY=5
   WORKER_MAX_RETRIES=3
   WORKER_RETRY_DELAY_MS=100
   ```

**Expected Output**:
- ✅ Redis container starts with Docker Compose
- ✅ Redis healthcheck passes: `docker compose exec redis redis-cli ping` → PONG
- ✅ Application can connect to Redis
- ✅ No breaking changes to existing Level 2 API logic

**Validation**:
```bash
# Start services
docker compose up -d

# Check Redis is healthy
docker compose ps
# redis should show "healthy"

# Test Redis connection
docker compose exec redis redis-cli ping
# Should return: PONG

# Check API still works (Level 2 logic intact)
curl http://localhost:3000/api/v1/events
# Should return events list
```

**Files Modified/Created**:
- `compose.yaml` (add Redis service)
- Root `package.json` (add bullmq, ioredis)
- `packages/lib/src/env.ts` (add Redis env vars)
- `packages/lib/src/redis.ts` (NEW - shared Redis client)
- `packages/lib/src/index.ts` (export redis)
- `.env.docker` (add Redis config)
- `.env.example` (add Redis config)

---

### **Milestone 2: Database Schema Migration - Event Versioning**

**Objective**: Add optimistic concurrency control by introducing a version column to events.

**Why Versioning?**: Optimistic locking requires tracking when records change. If two workers try to book the same ticket, the version check ensures only one succeeds.

**Tasks**:

1. **Schema Changes**

   Update `packages/database/src/schema.ts`:
   ```typescript
   export async function initializeDatabase(sql: Sql) {
     // Users table (unchanged)
     await sql`
       CREATE TABLE IF NOT EXISTS users (...)
     `;

     // Events table - ADD version column
     await sql`
       CREATE TABLE IF NOT EXISTS events (
         id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
         name VARCHAR(255) NOT NULL,
         total_tickets INT NOT NULL,
         available_tickets INT NOT NULL,
         version INT DEFAULT 0 NOT NULL,  -- NEW: Optimistic locking
         created_at TIMESTAMP DEFAULT NOW(),
         updated_at TIMESTAMP DEFAULT NOW()
       )
     `;

     // Bookings table (unchanged)
     await sql`
       CREATE TABLE IF NOT EXISTS bookings (...)
     `;

     // Migration: Add version to existing events (idempotent)
     await sql`
       DO $$
       BEGIN
         IF NOT EXISTS (
           SELECT 1 FROM information_schema.columns
           WHERE table_name = 'events' AND column_name = 'version'
         ) THEN
           ALTER TABLE events ADD COLUMN version INT DEFAULT 0 NOT NULL;
           UPDATE events SET version = 0 WHERE version IS NULL;
         END IF;
       END $$;
     `;
   }
   ```

2. **Type Definitions**

   Update `packages/types/src/event.ts`:
   ```typescript
   export type Event = {
     id: string;
     name: string;
     total_tickets: number;
     available_tickets: number;
     version: number;  // Add this
     created_at?: Date;
     updated_at?: Date;
   };

   export type CreateEventPayload = {
     name: string;
     total_tickets: number;
   };
   ```

3. **Update Event Queries**

   Update `apps/api/src/services/eventService.ts` to include version in responses:
   ```typescript
   async getEvents() {
     return await sql`
       SELECT
         id,
         name,
         total_tickets,
         available_tickets,
         version,  -- Add this
         created_at,
         updated_at
       FROM events
       ORDER BY created_at DESC
     `;
   }

   async getEventById(id: string) {
     const events = await sql`
       SELECT
         id,
         name,
         total_tickets,
         available_tickets,
         version,  -- Add this
         created_at,
         updated_at
       FROM events
       WHERE id = ${id}
     `;

     if (events.length === 0) {
       throw new AppError(ErrorCode.EVENT_NOT_FOUND);
     }

     return events[0];
   }
   ```

**Expected Output**:
- ✅ All events have `version = 0` after migration
- ✅ New events get `version = 0` automatically
- ✅ Type safety maintained throughout codebase
- ✅ API responses include version field
- ✅ No impact on Level 2 functionality

**Validation**:
```bash
# Restart services to run migration
docker compose restart server

# Check version column exists
docker compose exec db psql -U postgres -d tickets_hive -c "SELECT id, name, version FROM events LIMIT 5;"
# Should show version = 0 for all events

# API should return version
curl http://localhost:3000/api/v1/events
# Response should include "version": 0 in each event
```

**Files Modified/Created**:
- `packages/database/src/schema.ts` (add version column + migration)
- `packages/types/src/event.ts` (add version to type)
- `apps/api/src/services/eventService.ts` (include version in queries)

---

### **Milestone 3: Job Queue Architecture & Shared Type Contracts**

**Objective**: Define and implement the booking job data structure with strict Zod validation for API-Worker contract enforcement.

**Why Zod Validation?**: The API and Worker are separate processes. Zod schemas ensure they agree on data structure at runtime, preventing silent failures.

**Tasks**:

1. **Job Data Zod Schema (Shared Contract)**

   Create `packages/types/src/bookingJob.ts`:
   ```typescript
   import { z } from "zod";

   /**
    * Booking Job Data Schema
    *
    * This schema is the contract between API (producer) and Worker (consumer).
    * ALWAYS validate against this schema at both boundaries.
    */
   export const BookingJobSchema = z.object({
     userId: z.string().uuid("Invalid user ID format"),
     eventId: z.string().uuid("Invalid event ID format"),
     timestamp: z.number().int().positive(),
   });

   export type BookingJobData = z.infer<typeof BookingJobSchema>;
   ```

   Update `packages/types/src/index.ts`:
   ```typescript
   export * from "./auth.js";
   export * from "./event.js";
   export * from "./booking.js";
   export * from "./api.js";
   export * from "./bookingJob.js";  // Add this
   ```

2. **Queue Configuration**

   Create `packages/lib/src/queues.ts`:
   ```typescript
   import { Queue } from "bullmq";
   import { redis } from "./redis.js";
   import { env } from "./env.js";

   /**
    * Booking Queue Configuration
    *
    * This queue handles all ticket booking jobs.
    * Jobs are processed by workers with optimistic locking.
    */
   export const bookingQueue = new Queue("booking", {
     connection: redis,
     defaultJobOptions: {
       attempts: env.WORKER_MAX_RETRIES,
       backoff: {
         type: "exponential",
         delay: env.WORKER_RETRY_DELAY_MS,
       },
       removeOnComplete: {
         age: 3600, // Keep completed jobs for 1 hour
         count: 100,
       },
       removeOnFail: {
         age: 24 * 3600, // Keep failed jobs for 24 hours
         count: 1000,
       },
     },
   });

   // Graceful shutdown
   process.on("SIGTERM", async () => {
     await bookingQueue.close();
   });
   ```

   Update `packages/lib/src/index.ts`:
   ```typescript
   export * from "./errors.js";
   export * from "./errorHandler.js";
   export * from "./auth.js";
   export * from "./env.js";
   export * from "./redis.js";
   export * from "./queues.js";  // Add this
   ```

3. **Job Producer Logic (API)**

   Create `apps/api/src/services/queueService.ts`:
   ```typescript
   import { bookingQueue } from "@ticket-hive/lib";
   import { BookingJobData, BookingJobSchema } from "@ticket-hive/types";
   import { randomUUID } from "crypto";

   /**
    * Creates a booking job and adds it to the queue
    *
    * @returns jobId - Unique identifier for tracking this job
    */
   export async function createBookingJob(data: BookingJobData): Promise<string> {
     // Validate against shared schema (defense in depth)
     const validatedData = BookingJobSchema.parse(data);

     const jobId = `booking-${randomUUID()}`;

     await bookingQueue.add("process-booking", validatedData, {
       jobId,
     });

     return jobId;
   }

   /**
    * Gets job status (for MVP, returns basic info)
    */
   export async function getJobStatus(jobId: string) {
     const job = await bookingQueue.getJob(jobId);

     if (!job) {
       return { status: "not_found" };
     }

     const state = await job.getState();

     return {
       status: state,
       data: job.data,
       result: job.returnvalue,
       failedReason: job.failedReason,
     };
   }
   ```

**Expected Output**:
- ✅ Can add jobs to queue: `await bookingQueue.add('booking', data)`
- ✅ Jobs appear in Redis: `KEYS bull:booking:*`
- ✅ Invalid job data rejected at API boundary
- ✅ Type safety enforced across service boundary

**Validation**:
```bash
# Check Redis for queue keys
docker compose exec redis redis-cli KEYS "bull:*"
# Should show: (empty list) - queue exists but no jobs yet

# We'll test job creation in Milestone 6 when we migrate the API
```

**Files Modified/Created**:
- `packages/types/src/bookingJob.ts` (NEW - shared schema)
- `packages/types/src/index.ts` (export BookingJobSchema)
- `packages/lib/src/queues.ts` (NEW - queue configuration)
- `packages/lib/src/index.ts` (export bookingQueue)
- `apps/api/src/services/queueService.ts` (NEW - job producers)

---

### **Milestone 4: Worker Process & Service Architecture**

**Objective**: Create a separate worker service that processes booking jobs independently.

**Why Separate Service?**: Allows independent scaling. You can run 1 API instance with 5 worker instances to match your workload.

**Tasks**:

1. **Worker Service Structure**

   Create `apps/worker/src/index.ts`:
   ```typescript
   import { Worker } from "bullmq";
   import { redis } from "@ticket-hive/lib";
   import { env } from "@ticket-hive/lib";
   import { bookingProcessor } from "./processors/bookingProcessor.js";

   /**
    * Worker Service Entry Point
    *
    * This service processes booking jobs from the queue.
    * It runs independently from the API and can be scaled separately.
    */

   console.log("🔧 Starting worker service...");
   console.log(`Concurrency: ${env.WORKER_CONCURRENCY}`);
   console.log(`Max retries: ${env.WORKER_MAX_RETRIES}`);

   // Create worker
   const worker = new Worker("booking", bookingProcessor, {
     connection: redis,
     concurrency: env.WORKER_CONCURRENCY,
   });

   // Event handlers
   worker.on("completed", (job) => {
     console.log(`✅ Job ${job.id} completed`);
   });

   worker.on("failed", (job, err) => {
     console.error(`❌ Job ${job?.id} failed:`, err.message);
   });

   worker.on("error", (err) => {
     console.error("Worker error:", err);
   });

   // Graceful shutdown
   async function shutdown() {
     console.log("🛑 Shutting down worker...");
     await worker.close();
     await redis.quit();
     process.exit(0);
   }

   process.on("SIGTERM", shutdown);
   process.on("SIGINT", shutdown);

   console.log("✅ Worker service started. Listening for jobs...");
   ```

2. **Booking Processor (Skeleton)**

   Create `apps/worker/src/processors/bookingProcessor.ts`:
   ```typescript
   import { Job } from "bullmq";
   import { BookingJobData, BookingJobSchema } from "@ticket-hive/types";

   /**
    * Booking Job Processor
    *
    * Processes booking jobs with optimistic locking.
    * Implementation will be completed in Milestone 5.
    */
   export async function bookingProcessor(job: Job<BookingJobData>) {
     // Validate job data (defense in depth)
     const data = BookingJobSchema.parse(job.data);

     console.log(`📦 Processing job ${job.id}:`, {
       userId: data.userId,
       eventId: data.eventId,
       timestamp: new Date(data.timestamp).toISOString(),
     });

     // TODO: Implement optimistic locking logic in Milestone 5

     // For now, just log and return
     return {
       success: true,
       message: "Skeleton processor - implementation pending M5",
     };
   }
   ```

3. **Docker Service Setup**

   Update `compose.yaml`:
   ```yaml
   services:
     # ... existing services (db, redis, server)

     worker:
       build:
         context: .
         target: development
       command: node --watch --experimental-transform-types --env-file=/run/secrets/.env.docker apps/worker/src/index.ts
       volumes:
         - ./apps/worker/src:/usr/src/app/apps/worker/src
         - ./packages:/usr/src/app/packages
         - ./secrets/.env.docker:/run/secrets/.env.docker:ro
         - ./secrets/db_password.txt:/run/secrets/db_password:ro
         - ./secrets/jwt_secret.txt:/run/secrets/jwt_secret:ro
       environment:
         NODE_ENV: development
       depends_on:
         db:
           condition: service_healthy
         redis:
           condition: service_healthy
       restart: unless-stopped
   ```

4. **Update Worker Package Scripts**

   Update `apps/worker/package.json`:
   ```json
   {
     "name": "@ticket-hive/worker",
     "version": "1.0.0",
     "type": "module",
     "scripts": {
       "dev": "node --watch --experimental-transform-types --env-file=../../.env.local ./src/index.ts",
       "build": "tsc --noEmit",
       "start": "node --experimental-transform-types ./src/index.ts"
     },
     "dependencies": {
       "@ticket-hive/database": "*",
       "@ticket-hive/lib": "*",
       "@ticket-hive/types": "*"
     }
   }
   ```

**Expected Output**:
- ✅ Worker container starts and connects to Redis
- ✅ Worker logs show: "✅ Worker service started. Listening for jobs..."
- ✅ Worker can be scaled: `docker compose up -d --scale worker=3`
- ✅ Graceful shutdown works (completes current job before exiting)
- ✅ **Jobs are logged but not processed yet** (skeleton only)

**Validation**:
```bash
# Start worker
docker compose up -d worker

# Check worker logs
docker compose logs -f worker
# Should see: "✅ Worker service started. Listening for jobs..."

# Worker should stay running
docker compose ps
# worker should show "Up"

# Test scaling
docker compose up -d --scale worker=3
docker compose ps
# Should show 3 worker instances

# Scale back down
docker compose up -d --scale worker=1
```

**Files Modified/Created**:
- `apps/worker/src/index.ts` (NEW - worker entry point)
- `apps/worker/src/processors/bookingProcessor.ts` (NEW - skeleton)
- `apps/worker/package.json` (update scripts)
- `compose.yaml` (add worker service)

---

### **Milestone 5: Optimistic Locking Implementation in Workers**

**Objective**: Implement full booking logic in workers using optimistic locking with version numbers.

**CRITICAL**: This must be completed BEFORE migrating the API (M6), so workers can process jobs when API starts creating them.

**Tasks**:

1. **Complete Worker Processing Logic**

   Update `apps/worker/src/processors/bookingProcessor.ts`:
   ```typescript
   import { Job } from "bullmq";
   import { sql } from "@ticket-hive/database";
   import { BookingJobData, BookingJobSchema } from "@ticket-hive/types";
   import { AppError, ErrorCode } from "@ticket-hive/lib";

   /**
    * Level 3 Implementation: Optimistic Locking
    *
    * Uses version numbers to prevent race conditions WITHOUT row-level locks.
    * If version changed, BullMQ retries automatically.
    */
   export async function bookingProcessor(job: Job<BookingJobData>) {
     // Validate job data (defense in depth)
     const data = BookingJobSchema.parse(job.data);

     const { userId, eventId } = data;

     console.log(`📦 Processing job ${job.id}: user=${userId}, event=${eventId}`);

     // 1. Read event WITHOUT locking (optimistic approach)
     const events = await sql`
       SELECT id, available_tickets, version
       FROM events
       WHERE id = ${eventId}
     `;

     if (events.length === 0) {
       throw new AppError(ErrorCode.EVENT_NOT_FOUND);
     }

     const event = events[0];
     const currentVersion = event.version;

     // 2. Check availability
     if (event.available_tickets <= 0) {
       throw new AppError(ErrorCode.EVENT_SOLD_OUT);
     }

     // 3. Optimistic update: version MUST match
     const updateResult = await sql`
       UPDATE events
       SET
         available_tickets = available_tickets - 1,
         version = version + 1,
         updated_at = NOW()
       WHERE id = ${eventId}
         AND version = ${currentVersion}
         AND available_tickets > 0
       RETURNING id, version, available_tickets
     `;

     // 4. Check if update succeeded
     if (updateResult.count === 0) {
       // Version changed (another worker modified) OR sold out
       // BullMQ will retry this job automatically
       console.log(`⚠️ Version conflict for event ${eventId} (expected v${currentVersion})`);
       throw new AppError(ErrorCode.EVENT_SOLD_OUT_OR_CONFLICT);
     }

     // 5. Create booking record
     const bookingResult = await sql`
       INSERT INTO bookings (user_id, event_id, status, created_at)
       VALUES (${userId}, ${eventId}, 'CONFIRMED', NOW())
       RETURNING id, created_at
     `;

     const booking = bookingResult[0];
     const updatedEvent = updateResult[0];

     console.log(`✅ Booking created: ${booking.id} (${updatedEvent.available_tickets} tickets remaining)`);

     // 6. Return result
     return {
       success: true,
       bookingId: booking.id,
       eventId: eventId,
       remainingTickets: updatedEvent.available_tickets,
       version: updatedEvent.version,
     };
   }
   ```

2. **Add Error Code**

   Update `packages/lib/src/errors.ts`:
   ```typescript
   export const ErrorCode = {
     // ... existing codes
     EVENT_SOLD_OUT: "EVENT_SOLD_OUT",
     EVENT_SOLD_OUT_OR_CONFLICT: "EVENT_SOLD_OUT_OR_CONFLICT",  // Add this
   } as const;
   ```

3. **Test Optimistic Locking**

   Create `tests/test-optimistic-locking.ts`:
   ```typescript
   import { bookingQueue } from "@ticket-hive/lib";
   import { BookingJobData } from "@ticket-hive/types";
   import { randomUUID } from "crypto";

   /**
    * Test script: Send 10 concurrent jobs for same event
    * Expected: 1 succeeds, 9 retry and eventually fail (sold out)
    */
   async function testOptimisticLocking() {
     const eventId = "your-event-id-here"; // Create an event with 1 ticket
     const userId = randomUUID();

     const jobs: Promise<any>[] = [];

     // Send 10 concurrent jobs
     for (let i = 0; i < 10; i++) {
       const jobData: BookingJobData = {
         userId,
         eventId,
         timestamp: Date.now(),
       };

       jobs.push(bookingQueue.add("process-booking", jobData));
     }

     const results = await Promise.allSettled(jobs);
     console.log(`Created ${results.length} jobs`);

     // Wait for processing
     console.log("Waiting 10 seconds for workers to process...");
     await new Promise((resolve) => setTimeout(resolve, 10000));

     // Check results
     console.log("Done. Check worker logs and database.");
     process.exit(0);
   }

   testOptimisticLocking();
   ```

**Expected Output**:
- ✅ No `FOR UPDATE` queries in worker codebase
- ✅ Version checking prevents overbookings
- ✅ Retry logic handles conflicts gracefully
- ✅ Worker successfully processes booking jobs end-to-end
- ✅ Data integrity: Exactly 1 booking for 1-ticket event
- ✅ **API still uses Level 2 synchronous transactions** (not migrated yet)

**Validation**:
```bash
# Check worker logs for version conflicts
docker compose logs -f worker
# Should see: "⚠️ Version conflict..." messages during retries
# Should see: "✅ Booking created..." for successful bookings

# Verify no FOR UPDATE in worker code
grep -r "FOR UPDATE" apps/worker/
# Should return: (empty) - no matches

# Test with concurrent jobs
# 1. Create event with 1 ticket via API
# 2. Run test-optimistic-locking.ts
# 3. Check database: should have exactly 1 booking
docker compose exec db psql -U postgres -d tickets_hive -c "SELECT COUNT(*) FROM bookings;"
```

**Files Modified/Created**:
- `apps/worker/src/processors/bookingProcessor.ts` (complete implementation)
- `packages/lib/src/errors.ts` (add EVENT_SOLD_OUT_OR_CONFLICT)
- `tests/test-optimistic-locking.ts` (NEW - manual test)

---

### **Milestone 6: API Migration to Async Queue-Based Processing**

**Objective**: Migrate `POST /api/v1/bookings` from Level 2 synchronous to Level 3 async.

**This is the critical transition!** After this milestone, your system is fully async.

**Tasks**:

1. **Update Booking Route**

   Update `apps/api/src/routes/bookings.ts`:
   ```typescript
   import { Router } from "express";
   import { verifyToken } from "../middleware/verify-token.js";
   import { createBookingJob, getJobStatus } from "../services/queueService.js";
   import { BookingJobSchema } from "@ticket-hive/types";
   import { handleError } from "@ticket-hive/lib";

   const router = Router();

   /**
    * POST /api/v1/bookings
    *
    * Level 3: Creates a booking job and returns 202 Accepted
    * Client receives jobId to track status
    */
   router.post("/", verifyToken, async (req, res) => {
     try {
       const userId = req.user!.id;
       const { eventId } = req.body;

       // Validate job data
       const jobData = BookingJobSchema.parse({
         userId,
         eventId,
         timestamp: Date.now(),
       });

       // Create job instead of direct DB transaction
       const jobId = await createBookingJob(jobData);

       // Return 202 Accepted (not 201 Created)
       res.status(202).json({
         success: true,
         data: {
           jobId,
           status: "pending",
           message: "Booking request received. Processing asynchronously.",
         },
       });
     } catch (error) {
       handleError(error, res);
     }
   });

   /**
    * GET /api/v1/bookings/status/:jobId
    *
    * MVP: Returns job status (basic polling endpoint)
    * Production: Will use SSE (Milestone 7)
    */
   router.get("/status/:jobId", async (req, res) => {
     try {
       const { jobId } = req.params;
       const status = await getJobStatus(jobId);

       res.json({
         success: true,
         data: status,
       });
     } catch (error) {
       handleError(error, res);
     }
   });

   // Keep existing GET /:id and DELETE /:id routes (unchanged)

   export default router;
   ```

2. **Remove Level 2 Logic from Booking Service**

   The `bookingService.ts` file can be simplified or removed entirely since booking logic now lives in the worker. For MVP, you can keep the file but comment out the old logic:

   ```typescript
   // apps/api/src/services/bookingService.ts

   /**
    * NOTE: Level 3 Migration
    *
    * Booking creation logic has moved to:
    * - apps/api/src/services/queueService.ts (job creation)
    * - apps/worker/src/processors/bookingProcessor.ts (actual booking)
    *
    * This file now only handles:
    * - Getting existing bookings
    * - Canceling bookings
    */

   // Keep getBookingById and cancelBooking functions
   // Remove createBooking function (no longer used)
   ```

3. **Update Client Example**

   Create `examples/async-booking-client.ts`:
   ```typescript
   /**
    * Example: How to use the async booking API
    */

   async function bookTicket(authToken: string, eventId: string) {
     // 1. Create booking request
     const response = await fetch("http://localhost:3000/api/v1/bookings", {
       method: "POST",
       headers: {
         "Content-Type": "application/json",
         "Authorization": `Bearer ${authToken}`,
       },
       body: JSON.stringify({ eventId }),
     });

     const result = await response.json();

     if (response.status === 202) {
       const { jobId } = result.data;
       console.log(`✅ Booking request accepted. Job ID: ${jobId}`);

       // 2. Poll for status (MVP approach)
       const finalStatus = await pollJobStatus(jobId);
       console.log("Final status:", finalStatus);
     }
   }

   async function pollJobStatus(jobId: string) {
     for (let i = 0; i < 30; i++) {
       const response = await fetch(
         `http://localhost:3000/api/v1/bookings/status/${jobId}`
       );
       const result = await response.json();
       const { status, result: jobResult } = result.data;

       if (status === "completed") {
         return jobResult;
       }

       if (status === "failed") {
         throw new Error("Booking failed");
       }

       // Wait 1 second before next poll
       await new Promise((resolve) => setTimeout(resolve, 1000));
     }

     throw new Error("Timeout waiting for booking result");
   }
   ```

**Expected Output**:
- ✅ `POST /api/v1/bookings` returns 202 Accepted + jobId
- ✅ Response time <100ms
- ✅ Workers process jobs successfully
- ✅ No synchronous DB transactions in API
- ✅ `GET /api/v1/bookings/status/:jobId` returns job state
- ✅ Data integrity: Zero overbookings

**Validation**:
```bash
# Test async booking
curl -X POST http://localhost:3000/api/v1/bookings \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"eventId": "YOUR_EVENT_ID"}' \
  -w "\nTime: %{time_total}s\n"

# Expected response:
# Status: 202 Accepted
# Body: { "success": true, "data": { "jobId": "...", "status": "pending" } }
# Time: <0.1s

# Check job status
curl http://localhost:3000/api/v1/bookings/status/YOUR_JOB_ID

# Check worker processed it
docker compose logs worker | grep "✅ Booking created"

# Verify in database
docker compose exec db psql -U postgres -d tickets_hive \
  -c "SELECT id, user_id, event_id, status FROM bookings ORDER BY created_at DESC LIMIT 5;"
```

**Files Modified/Created**:
- `apps/api/src/routes/bookings.ts` (migrate to async)
- `apps/api/src/services/bookingService.ts` (remove createBooking)
- `examples/async-booking-client.ts` (NEW - usage example)

---

## ✅ MVP Completion Criteria

After completing Milestones 0-6, your system should have:

### Functional Requirements
- ✅ `POST /api/v1/bookings` returns 202 Accepted with jobId in <100ms
- ✅ Workers process jobs with optimistic locking (no FOR UPDATE)
- ✅ Version conflicts trigger automatic retry (max 3 attempts)
- ✅ `GET /api/v1/bookings/status/:jobId` returns job state
- ✅ Zero overbookings under concurrent load

### Architecture
- ✅ API and Worker are separate services
- ✅ Redis queue holds jobs
- ✅ BullMQ manages job lifecycle
- ✅ Zod validates at API and Worker boundaries
- ✅ PostgreSQL stores final booking data

### Performance
- ✅ API response time: <100ms (10x faster than Level 2)
- ✅ Worker processing: 200-500ms average
- ✅ Throughput: 10x improvement vs Level 2
- ✅ Can scale workers independently

### Data Integrity
- ✅ Exactly N bookings for N-ticket event
- ✅ `available_tickets` never negative
- ✅ Version increments correctly

---

## 🎓 MVP Demo Script

After completing the MVP, you can demo your system like this:

```bash
# 1. Show the architecture
docker compose ps
# Should show: db, redis, server (API), worker all running

# 2. Create a test event (100 tickets)
curl -X POST http://localhost:3000/api/v1/events \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "MVP Demo Concert", "total_tickets": 100}'

# 3. Create a booking (fast response!)
time curl -X POST http://localhost:3000/api/v1/bookings \
  -H "Authorization: Bearer $USER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"eventId": "EVENT_ID"}'
# Should return in <100ms with 202 Accepted

# 4. Check status
curl http://localhost:3000/api/v1/bookings/status/JOB_ID
# Should show: completed with booking ID

# 5. Show worker logs
docker compose logs worker | tail -20
# Should show: "✅ Booking created: ..."

# 6. Scale workers
docker compose up -d --scale worker=5
docker compose ps
# Should show: 5 worker instances

# 7. Run load test
npm run test:load
# Should show: 0% timeouts, 100 bookings created
```

---

## 📊 MVP vs Level 2 Comparison

| Metric | Level 2 | Level 3 MVP |
|--------|---------|-------------|
| API Response | 800-1500ms | <100ms |
| Throughput | 200-300 req/s | 2000-5000 req/s |
| Timeout Rate | 1-2% | 0% |
| Scalability | Vertical only | Horizontal (scale workers) |
| Race Conditions | 0 (pessimistic locks) | 0 (optimistic locks) |
| Complexity | Low | Medium |

---

## 🚀 Next Steps: Production Hardening

After completing the MVP, you can:

1. **Demo the system** - Show async processing in action
2. **Update your resume** - Add "Async queue-based processing with BullMQ"
3. **Write a blog post** - "Building a High-Concurrency Booking System"
4. **Move to Production Phase** - See `LEVEL_3_PRODUCTION_PLAN.md` for:
   - Server-Sent Events (real-time updates)
   - Rate limiting (prevent abuse)
   - Circuit breakers (handle Redis failures)
   - Monitoring dashboard (BullMQ UI)
   - 10K load testing

---

## 🛑 Common MVP Pitfalls

1. **Starting workers before implementing M5** - Workers will fail to process jobs
2. **Migrating API before workers ready** - Jobs created but not processed
3. **Skipping Zod validation** - Type mismatches cause silent failures
4. **Not testing version conflicts** - Optimistic locking bugs only appear under load
5. **Forgetting to remove Level 2 code** - Confusion about which logic is active

---

## 📝 MVP Implementation Checklist

**Foundation (Complete)**:
- ✅ Milestone 0: Monorepo restructure

**Infrastructure**:
- [ ] Milestone 1: Redis & BullMQ setup
- [ ] Verify Redis healthcheck passes
- [ ] Test Redis connection from API

**Data Layer**:
- [ ] Milestone 2: Add version column
- [ ] Run migration script
- [ ] Verify version appears in API responses

**Queue Architecture**:
- [ ] Milestone 3: Create Zod schemas and queues
- [ ] Test job validation
- [ ] Create queue service

**Worker Service**:
- [ ] Milestone 4: Build worker service
- [ ] Test worker starts and connects
- [ ] Test graceful shutdown

**Processing Logic**:
- [ ] Milestone 5: Implement optimistic locking
- [ ] Test version conflict handling
- [ ] Verify no FOR UPDATE in worker code
- [ ] Test concurrent bookings

**API Migration**:
- [ ] Milestone 6: Migrate booking endpoint
- [ ] Test 202 response
- [ ] Test job status endpoint
- [ ] Verify workers process jobs
- [ ] Run load test

**Final Validation**:
- [ ] API response <100ms
- [ ] Zero overbookings
- [ ] Workers scalable
- [ ] Data integrity maintained

---

## 🔗 Related Documents

- **SPECS.md** - Original project requirements
- **LEVEL_3_PRODUCTION_PLAN.md** - Production hardening (Milestones 7-10)
- **LEVEL_3_COMPLETE_PLAN.md** - Full plan (both MVP and Production)

---

*Last updated: 2025-01-27*
*Status: Ready for implementation*
