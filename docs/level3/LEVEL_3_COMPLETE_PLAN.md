# TicketHive Level 3 Implementation Plan

## 🎯 Goal: Queue-Based Async Processing with BullMQ & Redis

**Current State (Level 2):**
- Synchronous API processing with `FOR UPDATE` pessimistic locking
- 1-2% timeout rate under 1000 concurrent requests
- Direct database operations in API service
- Immediate response (201/409/503)

**Target State (Level 3):**
- Asynchronous request processing via job queues
- <100ms API response time returning 202 Accepted
- Worker processes handle booking logic separately
- Optimistic locking with versioning (no `FOR UPDATE`)
- Server-Sent Events for status updates
- Separate BullMQ dashboard service for monitoring
- Rate limiting & circuit breaker protection
- Configurable retry strategy via environment
- Zero timeout errors, 10x throughput improvement
- Handles 10,000+ concurrent requests

---

## 📋 Architecture Overview

```
┌─────────────┐      1. POST /book      ┌────────────────────┐
│             │ ──────────────────────► │                    │
│   Client    │    (with payload)       │  API Service       │
│             │                         │  (/apps/api)       │
└──────┬──────┘                         └───────────┬────────┘
       │                                           │
       │                                           │ 2. Rate limit check
       │                                           │ 3. Queue depth check
       │                                           │ 4. Circuit breaker check
       │                                           │ 5. Create booking job
       │                                           │    - Validate with Zod
       │                                           │    - Generate jobId
       │ 8. SSE (if not completed)                │ 6. Return 202 + jobId (<100ms)
       │ ◄─────────────────────────────────────────┤
       │                                           │ 7. Push to BullMQ Queue
       │                                           ▼
       │                                 ┌────────────────────┐
       │                                 │   Redis            │
       │                                 │   - Queue depth    │
       │                                 │   - Job persistence│
       │                                 └───────────┬────────┘
       │                                           │
       │                                           │ 9. Worker pulls job
       │                                           ▼
       │                                 ┌────────────────────┐
       │                                 │ Worker Service     │
       │                                 │ (/apps/worker)     │
       │                                 └───────────┬────────┘
       │                                           │
       │                                           │ 10. Optimistic locking
       │                                           │     (version check)
       │                                           │ 11. Database update
       │                                           ▼
       │                                 ┌────────────────────┐
       │                                 │ PostgreSQL         │
       │                                 │                    │
       │                                 └───────────┬────────┘
       │                                           │
       │                                           │ 12. QueueEvents publish
       │                                           ▼
       │                                 ┌────────────────────┐
       └─────────────────────────────────┤  QueueEvents       │
                                         │  (Redis Streams)   │
                                         └────────────────────┘

/packages
  /database  (Shared PostgreSQL client)
  /types     (Shared Zod schemas + TS types)
  /lib       (Shared utilities, errors, Redis client)

┌─────────────────────────────────────────────────────┐
│   Monitoring Stack                                  │
│   • Dashboard service (apps/dashboard)              │
│   • Rate limiter metrics                            │
│   • Circuit breaker metrics                         │
│   • Queue depth alerts                              │
│   • Version conflict rate alerts                    │
└─────────────────────────────────────────────────────┘
```

---

## 📖 Architectural Context: Why These Decisions Matter

### Problem 1: The "Fast Worker" Race Condition and Lost SSE Updates

**The Bug Pattern:**

In a production queue-based system, a common but subtle bug occurs when:

```
Timeline (milliseconds):
  0ms:  Client POST /book → API creates job → API returns 202 + jobId
 10ms:  Worker picks up job → Processes in 10ms → Publishes "completed" event
 50ms:  Client receives 202 response → Starts establishing SSE connection
 60ms:  Client connects to GET /api/v1/bookings/status/:jobId
         → Subscribes to Redis channel for updates
  → BUG: The "completed" event was published at 10ms, before subscription at 60ms
         Client waits forever, never receives the result
```

**Impact:**
- Client hangs indefinitely waiting for status that already happened
- User sees infinite loading spinner
- System resources wasted on dead connections
- Under load, this creates cascading timeout issues
- Debugging is difficult: worker logs show success, but client never receives it

**Why Traditional Approaches Fail:**

1. **Redis Pub/Sub with Simple Subscription:**
```typescript
// ❌ BROKEN: Subscribes after worker may have finished
app.get('/status/:jobId', (req, res) => {
  // Worker might have already published here!
  const subscriber = redis.createSubscriber();
  subscriber.subscribe('booking-events');
  
  subscriber.on('message', (message) => {
    if (message.jobId === req.params.jobId) {
      res.write(`event: ${message.type}\n`);
    }
  });
  
  // What if worker published before we subscribed?
  // → Client waits forever
});
```

2. **Message Persistence (Workaround):**
- Could persist all events to Redis/DB
- Client connects → queries history → subscribes
- But: Adds storage overhead, complexity, and latency
- Not suitable for high-frequency events like booking status updates

**Our Solution (Milestone 7): Check State BEFORE Subscribe**

```typescript
// ✅ ROBUST: Check state first, then subscribe only if needed
app.get('/status/:jobId', async (req, res) => {
  // 1. Check current job state IMMEDIATELY
  const job = await bookingQueue.getJob(req.params.jobId);
  
  if (job.returnvalue) {
    // Worker already finished! Send result immediately
    res.write(`event: confirmed\ndata: ${JSON.stringify(job.returnvalue)}\n\n`);
    return res.end();
  }
  
  if (job.failedReason) {
    // Already failed! Send failure immediately
    res.write(`event: failed\ndata: ${JSON.stringify(job.failedReason)}\n\n`);
    return res.end();
  }
  
  // 2. ONLY subscribe if job is still active
  const queueEvents = new QueueEvents('booking');
  queueEvents.on('completed', (event) => {
    if (event.jobId === req.params.jobId) {
      res.write(`event: confirmed\n`);
      res.end();
    }
  });
  
  // Send current status
  res.write(`event: ${job.status}\n`);
});
```

**Benefits:**
- ✅ Client always receives final status (even if late)
- ✅ No hanging connections
- ✅ No message persistence overhead
- ✅ Works reliably from 10ms to 10s processing times
- ✅ Handles network delays, slow clients, and retries

---

### Problem 2: Why Raw Redis Pub/Sub Doesn't Scale (And QueueEvents Does)

**The Horizontal Scaling Problem:**

When you have multiple API instances behind a load balancer:

```
Load Balancer
    ├─→ API Instance 1 (holds Client A's SSE connection)
    ├─→ API Instance 2 (holds Client B's SSE connection)
    └─→ API Instance 3 (holds Client C's SSE connection)

Worker completes job for Client A:
    → Publishes to Redis channel: "job:123 completed"
    → Which instance should forward to Client A?
    → How do instances know which connections they hold?
```

**Raw Redis Pub/Sub Approach (Complex & Brittle):**

```typescript
// ❌ COMPLEX: Each instance must track its own connections
const activeConnections = new Map(); // jobId → res

// Instance 1
globalRedisSubscriber.on('message', (channel, message) => {
  // Instance 1, 2, and 3 all receive this message!
  const event = JSON.parse(message);
  
  // But maybe only Instance 2 has the connection for this jobId
  const clientConnection = activeConnections.get(event.jobId);
  if (clientConnection) {
    // Instance 2 forwards to client
    clientConnection.write(`event: ${event.type}...`);
  }
  // Instances 1 & 3 ignore (no connection found)
});

// Problem 1: Connection tracking across instances is manual
// Problem 2: Race condition on instance restart (lost connections)
// Problem 3: Memory leaks if connections not cleaned up
// Problem 4: Each instance processes messages for ALL jobs (inefficient)
```

**Why This Doesn't Scale:**

1. **Connection State Synchronization:**
   - Each API instance must maintain a map: `jobId → clientResponse`
   - No built-in way to sync this state across instances
   - If Instance 1 crashes, all its SSE connections are lost
   - Clients must reconnect, but may hit different instance → state lost

2. **Message Filtering Overhead:**
   - Every instance receives EVERY job completion event
   - Instance 3 processes events for jobs it has no connection for
   - Under 10K concurrent bookings → 10K events × 3 instances = 30K messages
   - Wastes CPU and network bandwidth

3. **Connection Cleanup Complexity:**
   ```typescript
   // Need to handle:
   - Client disconnects
   - Instance crashes
   - Network timeouts
   - Process restarts
   // All must clean up connection state, or memory leaks
   ```

4. **Deployment Challenges:**
   - Rolling deployments: Old instances shutting down, new ones starting
   - How to migrate SSE connections without dropping updates?
   - Need custom connection migration logic

**BullMQ QueueEvents Solution (Built for This):**

```typescript
// ✅ SIMPLE: QueueEvents handles scaling automatically
import { QueueEvents } from 'bullmq';

// Each API instance creates its own QueueEvents listener
const queueEvents = new QueueEvents('booking');

queueEvents.on('completed', ({ jobId, returnvalue }) => {
  // This callback runs in EVERY instance
  
  // But we only have the connection object in ONE instance
  const clientConnection = activeConnections.get(jobId);
  
  if (clientConnection) {
    // Only the instance that holds the connection sends the response
    clientConnection.write(`event: confirmed\n`);
  }
  // Other instances just ignore (no connection found)
});
```

**How QueueEvents Solves Scaling:**

1. **Built-in Pub/Sub:**
   - Uses Redis Streams (not Pub/Sub) for reliable event delivery
   - Events persisted temporarily in Redis
   - Instances can reconnect and catch up on missed events
   - No manual channel management

2. **Efficient Event Routing:**
   - Events are lightweight: `{ jobId, status, returnvalue }`
   - No custom serialization needed
   - BullMQ manages the Redis keys and channels automatically

3. **Connection State Remains Local:**
   ```typescript
   // ✅ SIMPLE: Each instance only tracks its own connections
   const activeConnections = new Map(); // Only this instance's connections
   
   // No need to sync with other instances
   // No need for distributed state management
   // Each instance is independent
   ```

4. **Horizontal Scaling Benefits:**
```bash
# Scale API to 5 instances
docker compose up -d --scale api=5

# Each instance:
# - Receives all events via QueueEvents
# - Checks local connection map
# - Forwards only if connection exists
# - No coordination needed between instances

# Result: Linear scaling, no shared state
```

**Real-World Production Scenario:**

```
Before (Raw Redis Pub/Sub):
  - 3 API instances
  - 10,000 concurrent booking requests
  - Each job completion = 3 messages (one per instance)
  - Total: 10,000 jobs × 3 instances = 30,000 messages
  - Each instance processes 30,000 messages (most ignored)
  → 66% wasted CPU, complex connection tracking

After (BullMQ QueueEvents):
  - 3 API instances
  - 10,000 concurrent booking requests
  - Each job completion = 1 lightweight event
  - Each instance checks local map, only 1 instance forwards
  → 0% wasted CPU, simple local state
```

**Why QueueEvents is the Right Choice:**

1. **Purpose-Built:** Designed specifically for BullMQ job lifecycle events
2. **Type-Safe:** Events typed as `{ jobId: string, status: string, ... }`
3. **Reliable:** Uses Redis Streams, not Pub/Sub (persistent vs ephemeral)
4. **Efficient:** Minimal overhead, no manual serialization
5. **Battle-Tested:** Used in production at scale by many companies
6. **Documented:** Official BullMQ documentation and examples

**When to Use Raw Redis Pub/Sub Instead:**

Never for this use case. QueueEvents is superior in every way for job status notifications.

The only time to use raw Redis Pub/Sub is for non-BullMQ events (e.g., custom notifications, chat messages) where you need custom channel management.

---

## 🛣️ Implementation Roadmap: 10 Milestones

### **Milestone 0: Monorepo Restructure - Foundation Preparation**

**Objective:** Reorganize the existing Level 2 monolith into a monorepo structure BEFORE introducing Level 3 complexity. This prevents debugging nightmares during the transition.

** Tasks:**
1. **Create Monorepo Structure**
   ```
   /apps
     /api          (Move existing src/* here)
     /worker       (Will be populated in Milestone 4)
   /packages
     /database     (Extract db.ts, schema, migrations)
     /types        (Extract all TypeScript interfaces)
     /lib          (Extract shared utilities, errors, auth)
   ```

2. **Extract Shared Database Layer**
   - Move `src/lib/db.ts` → `packages/database/src/index.ts`
   - Move database initialization logic
   - Update imports to use package reference
   - Ensure connection pooling works from both API and Worker

3. **Extract Shared Types**
   - Move `src/types/index.ts` → `packages/types/src/index.ts`
   - Extract all interfaces: Event, Booking, User, etc.
   - Create Zod validation schemas for API payloads
   - Ensure types compile in both apps

4. **Extract Shared Utilities**
   - Move `src/lib/errors.ts` → `packages/lib/src/errors.ts`
   - Move `src/lib/errorHandler.ts` → `packages/lib/src/errorHandler.ts`
   - Move `src/lib/auth.ts` → `packages/lib/src/auth.ts`
   - Move `src/lib/env.ts` → `packages/lib/src/env.ts`

5. **Update API Application**
   - Move all route handlers to `apps/api/src/routes/`
   - Move all services to `apps/api/src/services/`
   - Move middleware to `apps/api/src/middleware/`
   - Update all import paths to use `@ticket-hive/database`, `@ticket-hive/types`, etc.

6. **Configure Build System**
   - Add `turbo.json` for build pipeline orchestration
   - Update root `package.json` with workspaces configuration
   - Add individual `package.json` files for each package/app
   - Ensure TypeScript paths resolve correctly

7. **Update Docker Configuration**
   - Modify `Dockerfile` for monorepo multi-stage builds
   - Update `docker-compose.yml` to mount correct volumes
   - Ensure hot-reload works for development

8. **Verification**
   - Run existing Level 2 load tests: `npm run test:load`
   - Verify exactly 100 bookings, zero overbookings
   - Confirm all existing functionality works
   - **Do not proceed to Milestone 1 until this passes**

**Expected Output:**
- ✅ Existing Level 2 code runs in new monorepo structure
- ✅ All tests pass without modification
- ✅ Imports resolve correctly across packages
- ✅ Docker Compose starts all services successfully
- ✅ Zero functional changes to Level 2 logic

**Files Modified/Created:**
- `/apps/api/src/*` (moved from root `src/`)
- `/packages/database/package.json` (new)
- `/packages/types/package.json` (new)
- `/packages/lib/package.json` (new)
- `/apps/api/package.json` (new)
- `/apps/worker/package.json` (new, empty for now)
- Root `package.json` (add workspaces)
- `turbo.json` (new, build orchestration)
- `Dockerfile` (update for monorepo)

**Validation:**
```bash
# After restructure
docker compose up -d
npm run test:load
# Should show same results as Level 2:
# - 100 bookings created
# - 0 overbookings
# - 1-2% timeout rate (expected for Level 2)
```

---

### **Milestone 1: Infrastructure Setup - Redis & BullMQ Foundation**

**Objective:** Add Redis service and BullMQ dependencies to enable queue-based processing. Builds ON TOP of the monorepo structure from Milestone 0.

** Tasks:**
1. **Docker Compose Updates**
   - Add Redis service to `compose.yaml`
   - Configure Redis ports (6379)
   - Add Redis healthcheck
   - Add Redis dependency to API service

2. **Package Dependencies**
   ```bash
   # In root directory
   npm install bullmq ioredis
   npm install -D @types/ioredis
   ```

3. **Environment Configuration**
   - Add Redis configuration to `packages/lib/src/env.ts`:
     ```typescript
     REDIS_HOST: z.string().default("localhost"),
     REDIS_PORT: z.number().default(6379),
     REDIS_PASSWORD: z.string().optional(),
     // Retry strategy configuration
     WORKER_MAX_RETRIES: z.number().default(3),
     WORKER_RETRY_DELAY_MS: z.number().default(100),
     WORKER_RETRY_MAX_DELAY_MS: z.number().default(1000),
     WORKER_CONCURRENCY: z.number().default(5),
     REDIS_QUEUE_MAX_DEPTH: z.number().default(1000),
     // Circuit breaker
     CIRCUIT_BREAKER_TIMEOUT: z.number().default(3000),
     CIRCUIT_BREAKER_ERROR_THRESHOLD: z.number().default(50),
     CIRCUIT_BREAKER_RESET_TIMEOUT: z.number().default(30000),
     ```
   - Update `.env.example` with Redis defaults

4. **Redis Connection Setup**
   - Create `packages/lib/src/redis.ts` with connection factory
   - Implement connection retry logic (3 attempts)
   - Export shared Redis instance for BullMQ
   - **Import from shared lib package, not directly from src**

**Expected Output:**
- ✅ Redis container starts with Docker Compose
- ✅ Application connects to Redis successfully
- ✅ Healthcheck passes: `docker compose exec redis redis-cli ping`
- ✅ No breaking changes to existing Level 2 API logic
- ✅ All imports resolve via packages

**Files Modified/Created:**
- `compose.yaml` (add Redis service)
- Root `package.json` (add bullmq, ioredis, zod)
- `packages/lib/src/env.ts` (add Redis and retry env vars)
- `packages/lib/src/redis.ts` (new file, shared Redis client)

**Validation:**
```bash
docker compose up -d
# Redis should be healthy
docker compose logs redis
# Should show: Ready to accept connections
```

---

### **Milestone 2: Database Schema Migration - Event Versioning**

**Objective:** Add optimistic concurrency control by introducing a version column to events.

** Tasks:**
1. **Schema Changes**
   - Add `version INT DEFAULT 0 NOT NULL` to `events` table
   - Create migration script in `packages/database/scripts/migrate-level3.ts`
   - Backfill existing events: `UPDATE events SET version = 0`
   - Add unique constraint for safety: `UNIQUE(id, version)`

2. **Update Database Initialization**
   - Modify `packages/database/src/db.ts` `initializeDatabase()`
   - Add version column to CREATE TABLE statement
   - Update timestamp: `updated_at TIMESTAMP DEFAULT NOW()` for optimistic locking

3. **Type Definitions**
   - Update `packages/types/src/index.ts` Event interface
   - Add `version: number` field to Event type
   - Update all related type guards

4. **Event Service Updates**
   - Modify `apps/api/src/services/eventService.ts`
   - Add `getEventWithVersion()` for worker consumption
   - Update `getEventById()` to return version

**Expected Output:**
- ✅ All events have version = 0 after migration
- ✅ New events get version = 0 automatically
- ✅ Type safety maintained throughout codebase
- ✅ No impact on Level 2 functionality yet

**Files Modified/Created:**
- `packages/database/src/db.ts` (add version column)
- `packages/types/src/index.ts` (add version to types)
- `packages/database/scripts/migrate-level3.ts` (new migration script)
- `apps/api/src/services/eventService.ts` (add version support)

**Validation:**
```sql
-- After migration
SELECT id, name, version FROM events LIMIT 5;
-- Should show version = 0 for all events
```

---

### **Milestone 3: Job Queue Architecture & Shared Type Contracts**

**Objective:** Define and implement the booking job data structure with strict Zod validation for API-Worker contract enforcement.

** Tasks:**
1. **Job Data Zod Schema (Shared Contract)**
   Create `packages/types/src/bookingJob.ts`:
   ```typescript
   import { z } from 'zod';
   
   export const BookingJobSchema = z.object({
     userId: z.string().uuid(),
     eventId: z.string().uuid(),
     timestamp: z.number().int().positive(),
     // Add idempotency key (for Level 4 compatibility)
     idempotencyKey: z.string().uuid().optional()
   });
   
   export type BookingJobData = z.infer<typeof BookingJobSchema>;
   ```

2. **Queue Configuration**
   - Create `packages/lib/src/queues.ts`
   - Define queue names: `bookingQueue`, `notificationQueue`
   - Configure BullMQ with Redis connection (using shared Redis client)
   - Set default job options:
     ```typescript
     {
       attempts: 3,
       backoff: { type: 'exponential', delay: 100 },
       timeout: 30000, // 30 second job timeout
       removeOnComplete: { age: 3600 }, // Keep for 1 hour
       removeOnFail: { age: 24 * 3600 } // Keep for 24 hours
     }
     ```

3. **Job Producer Logic (API)**
   - Create `apps/api/src/services/queueService.ts`
   - Implement `createBookingJob()` function
   - **Validate payload with Zod schema BEFORE queueing**
   - Return job ID immediately
   ```typescript
   export async function createBookingJob(data: BookingJobData): Promise<string> {
     // Validate against shared schema
     const validatedData = BookingJobSchema.parse(data);
     
     const job = await bookingQueue.add('process-booking', validatedData, {
       jobId: `booking-${validatedData.idempotencyKey || uuid()}`,
     });
     
     return job.id;
   }
   ```

4. **Job Consumer Setup (Worker)**
   - Create `apps/worker/src/processors/bookingProcessor.ts`
   - Register queue processor with BullMQ
   - Set concurrency: 5 workers (configurable via env: `WORKER_CONCURRENCY=5`)
   - **Validate job data with Zod schema on consumption**
   ```typescript
   export const bookingProcessor = async (job: Job<BookingJobData>) => {
     // Validate at consume time (defense in depth)
     const data = BookingJobSchema.parse(job.data);
     
     // Process booking...
   };
   ```

**Expected Output:**
- ✅ Can add jobs to queue: `await bookingQueue.add('booking', data)`
- ✅ Jobs appear in Redis: `bull:booking:...`
- ✅ Worker can receive and log jobs
- ✅ Job lifecycle events tracked (waiting, active, completed, failed)
- ✅ Invalid job data rejected at API and Worker boundaries
- ✅ Type safety enforced across service boundary

**Files Modified/Created:**
- `packages/types/src/bookingJob.ts` (NEW - shared schema)
- `packages/lib/src/queues.ts` (queue definitions with validation)
- `apps/api/src/services/queueService.ts` (job producers with validation)
- `apps/worker/src/processors/bookingProcessor.ts` (job consumers with validation)
- `apps/worker/src/index.ts` (worker entry point)
- `apps/api/src/lib/dashboard.ts` (BullMQ dashboard)

**Validation:**
```bash
# Check Redis for queued jobs
docker compose exec redis redis-cli KEYS "bull:*"
# Should show: bull:booking:id

# Test validation
# API: Try to send invalid data → should reject before queue
# Worker: Try to process corrupted job → should fail validate
```

---

### **Milestone 4: Worker Process & Service Architecture**

**Objective:** Create a separate worker service that processes booking jobs independently.

** Tasks:**
1. **Worker Service Creation**
   - Create `apps/worker/src/index.ts` (worker entry point)
   - Import and start all queue processors
   - Add graceful shutdown handling (SIGTERM, SIGINT)
   - Add worker health endpoint (`/health`)
   - Set concurrency from environment: `env.WORKER_CONCURRENCY`

2. **Docker Service Setup**
   - Add `worker` service to `compose.yaml`
   - Set startup command: `node apps/worker/dist/index.js` (production) or `node --watch --experimental-transform-types apps/worker/src/index.ts` (dev)
   - Share same environment variables as API
   - Add volume mounts for hot-reload in development

3. **Booking Processor (Skeleton)**
   - Create `apps/worker/src/processors/bookingProcessor.ts` with stub implementation
   - Extract `userId`, `eventId` from job data (already validated by Zod)
   - Log job receipt and queue depth monitoring
   - Add placeholder for optimistic locking logic (Milestone 8)
   - Handle graceful failure: no database calls yet
   - **IMPORTANT: Do NOT implement actual booking logic here yet**

4. **Database Connection Management**
   - Worker needs direct PostgreSQL access
   - Import shared database client from `packages/database`
   - Ensure connection pool separate from API (different env vars if needed)

**Expected Output:**
- ✅ Worker container starts and connects to Redis
- ✅ Worker polls queue for jobs
- ✅ Worker logs show job receipt (no processing yet)
- ✅ Worker can be scaled: `docker compose up -d --scale worker=3`
- ✅ Graceful shutdown works (completes current job before exiting)
- ✅ **No optimistic locking implementation yet** (that comes in Milestone 8)

**Files Modified/Created:**
- `apps/worker/src/index.ts` (worker entry)
- `apps/worker/src/processors/bookingProcessor.ts` (skeleton)
- `compose.yaml` (add worker service)
- `apps/api/src/middleware/worker-health.ts` (health monitoring)

**Validation:**
```bash
# Start worker
docker compose up -d worker
# Check worker logs
docker compose logs -f worker
# Should see: "Worker listening for booking jobs..."
# Jobs should be logged as received but not processed

# Test scaling
docker compose up -d --scale worker=3
docker compose logs worker
# Should see 3 worker instances processing
```

---

### **Milestone 5: Optimistic Locking Implementation in Workers**

**Objective:** Implement booking logic in workers using optimistic locking with version numbers. **This MUST come before API migration.**

**CRITICAL ORDERING NOTE:** This milestone must be completed BEFORE Milestone 6 (API migration) to prevent deploying a system where the API creates jobs that workers cannot process.

** Tasks:**
1. **Complete Worker Processing Logic**
   - Update `apps/worker/src/processors/bookingProcessor.ts` with full implementation
   - Use optimistic locking pattern (no FOR UPDATE):
   ```typescript
   async function processBooking(job: Job<BookingJobData>) {
     const { userId, eventId } = job.data;
     
     // Read event WITHOUT locking
     const events = await sql`
       SELECT * FROM events 
       WHERE id = ${eventId}
     `;
     const event = events[0];
     
     if (!event) {
       throw new AppError(ErrorCode.EVENT_NOT_FOUND);
     }
     
     // Optimistic update: version must match
     const currentVersion = event.version;
     const result = await sql`
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
     
     // Check if update succeeded
     if (result.count === 0) {
       // Either version changed (conflict) or sold out
       throw new AppError(ErrorCode.EVENT_SOLD_OUT_OR_CONFLICT);
     }
     
     // Create booking record
     const bookingResult = await sql`
       INSERT INTO bookings (user_id, event_id, status)
       VALUES (${userId}, ${eventId}, 'CONFIRMED')
       RETURNING id
     `;
     
     return {
       success: true,
       bookingId: bookingResult[0].id,
       eventId,
       remainingTickets: result[0].available_tickets
     };
   }
   ```

2. **Retry Strategy with Configurable Backoff**
   ```typescript
   // In packages/lib/src/queues.ts
   export const bookingQueue = new Queue('booking', {
     connection: redis,
     defaultJobOptions: {
       attempts: env.WORKER_MAX_RETRIES,
       backoff: {
         type: 'exponential',
         delay: env.WORKER_RETRY_DELAY_MS
       },
       timeout: 30000,
       removeOnComplete: { age: 3600 },
       removeOnFail: { age: 24 * 3600 }
     }
   });
   ```
   - Add jitter to prevent thundering herd:
   ```typescript
   const jitter = Math.random() * 100; // 0-100ms random
   const delay = Math.min(
     delay * 2 + jitter, 
     env.WORKER_RETRY_MAX_DELAY_MS
   );
   ```

3. **Handle Version Conflicts**
   - Retry on version conflict (BullMQ handles this automatically)
   - Log conflict rate for monitoring
   - No custom retry logic needed (BullMQ retry strategy applies)

4. **Race Condition Testing**
   - Run 1000 concurrent requests
   - Monitor for "version conflict" errors in failed jobs (expected)
   - Verify version conflicts result in retry, not failure
   - Verify exactly 100 bookings created
   - Verify available_tickets = 0 (not negative)
   - Check version numbers: final version should be 100

5. **Performance Comparison**
   - Measure throughput vs Level 2
   - Verify worker processing time (~200-500ms avg)
   - Monitor retry rate (should be <5% under 1000 concurrent)

**Expected Output:**
- ✅ No `FOR UPDATE` queries in worker codebase
- ✅ Version checking prevents overbooking
- ✅ Retry logic handles conflicts gracefully
- ✅ Worker successfully processes booking jobs end-to-end
- ✅ Data integrity: 100 bookings, 0 available tickets
- ✅ **API still uses Level 2 synchronous transactions** (not migrated yet)

**Files Modified/Created:**
- `apps/worker/src/processors/bookingProcessor.ts` (complete implementation)
- `packages/lib/src/queues.ts` (retry configuration with env vars)
- `packages/database/src/events.ts` (version update queries)
- `scripts/benchmark-level2-vs-level3.ts` (performance comparison)

**Validation:**
```bash
# Test worker processing directly
curl -X POST http://localhost:3000/api/v1/bookings \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"eventId": "..."}'
# Should still return 201 (still using Level 2)

# Check worker logs
docker compose logs -f worker
# Should show jobs being processed (if any exist)

# Run load test to verify locking
npm run test:load
# Should show exactly 100 bookings
# available_tickets = 0
# Version conflicts < 5%
# (Worker will process Level 2 jobs if queue exists)
```

---

### **Milestone 6: Server-Sent Events (SSE) Implementation with BullMQ QueueEvents**

**Objective:** Provide real-time status updates to clients via Server-Sent Events, using BullMQ QueueEvents for reliable horizontal scaling.

** Tasks:**
1. **SSE Endpoint Setup**
   ```typescript
   // GET /api/v1/bookings/status/:jobId
   app.get('/api/v1/bookings/status/:jobId', (req, res) => {
     res.writeHead(200, {
       'Content-Type': 'text/event-stream',
       'Cache-Control': 'no-cache',
       'Connection': 'keep-alive',
     });
   });
   ```

2. **BullMQ QueueEvents Integration**
   - Create `apps/api/src/services/notificationService.ts`
   - Use BullMQ's `QueueEvents` (NOT raw Redis Pub/Sub):
   ```typescript
   import { QueueEvents } from 'bullmq';
   
   const queueEvents = new QueueEvents('booking');
   
   queueEvents.on('completed', ({ jobId, returnvalue }) => {
     // Broadcast to all API instances
     // Only instance with open SSE connection sends to client
   });
   
   queueEvents.on('failed', ({ jobId, failedReason }) => {
     // Handle failure events
   });
   ```
   - QueueEvents ensures ALL API instances receive job updates
   - Each API instance checks if it holds the SSE connection for that jobId
   - Eliminates manual Redis Pub/Sub complexity

3. **Connection Management**
   ```typescript
   // Track active SSE connections per API instance
   const activeConnections = new Map<string, ServerResponse>();
   
   // On client connect
   activeConnections.set(jobId, res);
   
   // On client disconnect
   req.on('close', () => {
     activeConnections.delete(jobId);
   });
   ```

4. **Event Flow**
   ```
   Worker → QueueEvents (Redis) → All API Instances
                                      ↓
                             Check if has connection for jobId
                                      ↓
                           Forward to connected client via SSE
   ```

5. **Client Example**
   - Create `examples/sse-client.html`
   - Demonstrate EventSource API usage
   - Show connection, reconnection, and status updates
   - Include auth header support

**Expected Output:**
- ✅ Client can connect to SSE endpoint
- ✅ Real-time status updates delivered
- ✅ Automatic reconnection on disconnect (EventSource built-in)
- ✅ Multiple clients can listen to same job
- ✅ Works with multiple API instances (QueueEvents broadcasts to all)
- ✅ Client receives missed events if joins late (see Milestone 7)

**Files Modified/Created:**
- `apps/api/src/routes/booking-status.ts` (SSE implementation)
- `apps/api/src/services/notificationService.ts` (QueueEvents logic)
- `examples/sse-client.html` (client example)
- BullMQ dashboard mounted at `/admin/queues`

**Validation:**
```javascript
const eventSource = new EventSource('/api/v1/bookings/status/{jobId}');
eventSource.addEventListener('queued', (event) => {
  console.log('Status:', JSON.parse(event.data));
});
eventSource.addEventListener('confirmed', (event) => {
  console.log('Booking confirmed:', JSON.parse(event.data));
  eventSource.close();
});
```

---

### **Milestone 7: Robust SSE - "Fast Worker" Race Condition Fix**

**Objective:** Handle the race condition where worker finishes before client connects to SSE, ensuring clients always receive final status.

** Tasks:**
1. **Add Circuit Breaker for Redis**
   ```typescript
   // packages/lib/src/redis.ts
   import CircuitBreaker from 'opossum';
   
   const redisCircuitBreaker = new CircuitBreaker(
     async (operation: () => Promise<any>) => operation(),
     {
       timeout: env.CIRCUIT_BREAKER_TIMEOUT,
       errorThresholdPercentage: env.CIRCUIT_BREAKER_ERROR_THRESHOLD,
       resetTimeout: env.CIRCUIT_BREAKER_RESET_TIMEOUT,
       rollingCountTimeout: 10000,
       rollingCountBuckets: 10,
     }
   );
   
   export async function getRedisConnection() {
     return redisCircuitBreaker.fire(() => {
       // Redis connection attempt
     });
   }
   ```

2. **Check State Before Subscribing**
   ```typescript
   // In GET /api/v1/bookings/status/:jobId
   
   // 1. Immediately check current job state
   const job = await bookingQueue.getJob(jobId);
   
   if (!job) {
     res.write(`event: error\ndata: {"message": "Job not found"}\n\n`);
     return res.end();
   }
   
   // 2. If already completed, send result immediately
   if (job.returnvalue) {
     const result = job.returnvalue;
     if (result.success) {
       res.write(`event: confirmed\ndata: ${JSON.stringify(result)}\n\n`);
     } else {
       res.write(`event: failed\ndata: ${JSON.stringify(result)}\n\n`);
     }
     return res.end();
   }
   
   // 3. If failed, send failure reason
   if (job.failedReason) {
     res.write(`event: failed\ndata: ${JSON.stringify({ error: job.failedReason })}\n\n`);
     return res.end();
   }
   
   // 4. Only subscribe if job is still active (waiting/processing)
   res.write(`event: queued/processing\ndata: ${JSON.stringify({ status: job.status })}\n\n`);
   
   // Now subscribe to QueueEvents for updates
   const queueEvents = new QueueEvents('booking');
   const onCompleted = ({ jobId: completedId, returnvalue }) => {
     if (completedId === jobId) {
       res.write(`event: confirmed\ndata: ${JSON.stringify(returnvalue)}\n\n`);
       res.end();
       cleanup();
     }
   };
   
   const onFailed = ({ jobId: failedId, failedReason }) => {
     if (failedId === jobId) {
       res.write(`event: failed\ndata: ${JSON.stringify({ error: failedReason })}\n\n`);
       res.end();
       cleanup();
     }
   };
   
   queueEvents.on('completed', onCompleted);
   queueEvents.on('failed', onFailed);
   
   // Cleanup on disconnect
   const cleanup = () => {
     queueEvents.off('completed', onCompleted);
     queueEvents.off('failed', onFailed);
     activeConnections.delete(jobId);
   };
   
   req.on('close', cleanup);
   ```

3. **Hard Fail on Redis Unavailability**
   ```typescript
   // In queue service
   if (redisCircuitBreaker.opened) {
     throw new AppError(
       ErrorCode.REDIS_UNAVAILABLE,
       'Queue temporarily unavailable'
     );
   }
   ```

4. **Scenarios Handled**
   - **Fast Worker**: Worker finished at t=10ms, client connects at t=50ms → Job state check returns completed → Client receives result immediately
   - **Normal Case**: Worker still processing → Client subscribes → Receives updates via QueueEvents
   - **Late Join**: Client retries after disconnect → State check catches them up
   - **Job Failed**: State check or event notification sends failure reason
   - **Redis Down**: Circuit breaker returns 503 immediately, no hanging

5. **Event Types**
   - `event: queued` - Job received, waiting for worker
   - `event: processing` - Worker picked up job (job.started)
   - `event: confirmed` - Booking successful (with bookingId)
   - `event: failed` - Booking failed (reason: sold out, error)
   - `event: error` - System error (job not found, etc.)

6. **Testing the Race Condition**
   ```typescript
   // Test case: Worker completes in <100ms
   it('should return confirmed immediately if worker finished early', async () => {
     // Create job that completes instantly
     const job = await bookingQueue.add('instant-booking', data);
     await worker.processJob(job); // Simulate immediate completion
     
     // Client connects later
     await sleep(200); // 200ms delay
     
     const response = await request(app)
       .get(`/api/v1/bookings/status/${job.id}`)
       .set('Accept', 'text/event-stream');
     
     // Should immediately return confirmed, not hang
     expect(response.text).toContain('event: confirmed');
   });
   ```

**Expected Output:**
- ✅ Client receives status even if worker finished before connection
- ✅ No hanging connections waiting for missed events
- ✅ Works reliably under load with fast workers
- ✅ Scales horizontally (QueueEvents ensures all API instances receive updates)
- ✅ Circuit breaker protects against Redis failures
- ✅ Returns 503 immediately if Redis unavailable (hard fail)

**Files Modified/Created:**
- `apps/api/src/routes/booking-status.ts` (enhanced with state check)
- `apps/api/src/services/notificationService.ts` (QueueEvents handlers)
- `packages/lib/src/redis.ts` (add circuit breaker)
- `tests/integration/sse-race-condition.test.ts` (new test)

**Validation:**
```bash
# Manual test
1. Create booking request → get jobId
2. Check worker logs to see it completed quickly
3. Wait 2-3 seconds
4. Connect to SSE endpoint
5. Should immediately receive 'confirmed' event
# (No hanging, no waiting)

# Test Redis failure
docker compose stop redis
curl -X POST http://localhost:3000/api/v1/bookings \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"eventId": "..."}'
# Expected: 503 Service Unavailable, not hang
docker compose start redis
```

---

### **Milestone 8: Optimistic Locking Implementation in Workers**

**Objective:** Replace `FOR UPDATE` with optimistic locking using version numbers.

** Tasks:**
1. **Worker Processing Logic (in Worker Processor)**
   ```typescript
   async function processBooking(job: Job<BookingJobData>) {
     const { userId, eventId } = job.data;
     
     // Read event WITHOUT locking
     const events = await sql`
       SELECT * FROM events 
       WHERE id = ${eventId}
     `;
     const event = events[0];
     
     if (!event) {
       throw new AppError(ErrorCode.EVENT_NOT_FOUND);
     }
     
     // Optimistic update: version must match
     const currentVersion = event.version;
     const result = await sql`
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
     
     // Check if update succeeded
     if (result.count === 0) {
       // Either version changed (conflict) or sold out
       // Let BullMQ retry logic handle it
       throw new AppError(ErrorCode.EVENT_SOLD_OUT_OR_CONFLICT);
     }
     
     // Create booking record
     const bookingResult = await sql`
       INSERT INTO bookings (user_id, event_id, status)
       VALUES (${userId}, ${eventId}, 'CONFIRMED')
       RETURNING id
     `;
     
     return {
       success: true,
       bookingId: bookingResult[0].id,
       eventId,
       remainingTickets: result[0].available_tickets
     };
   }
   ```

2. **Retry Strategy in BullMQ**
   ```typescript
   // In packages/lib/src/queues.ts
   export const bookingQueue = new Queue('booking', {
     connection: redis,
     defaultJobOptions: {
       attempts: 3,
       backoff: {
         type: 'exponential',
         delay: 100 // Start with 100ms, then 200ms, then 400ms
       }
     }
   });
   ```

3. **Race Condition Testing**
   - Run 1000 concurrent requests
   - Monitor for "version conflict" errors in failed jobs (expected)
   - Verify version conflicts result in retry, not failure
   - Verify exactly 100 bookings created
   - Verify available_tickets = 0 (not negative)
   - Check version numbers: final version should be 100

4. **Performance Comparison**
   - Measure throughput vs Level 2
   - Verify <100ms API response time
   - Check worker processing time (~200-500ms avg)
   - Monitor retry rate (should be <5% under 1000 concurrent)

**Expected Output:**
- ✅ No `FOR UPDATE` queries in codebase
- ✅ Version checking prevents overbooking
- ✅ Retry logic handles conflicts gracefully
- ✅ Throughput 5-10x higher than Level 2
- ✅ Zero timeout errors
- ✅ Data integrity: 100 bookings, 0 available tickets

**Files Modified/Created:**
- `apps/worker/src/processors/bookingProcessor.ts` (optimistic locking logic)
- `packages/lib/src/queues.ts` (retry configuration)
- `packages/database/src/events.ts` (version update queries)
- `scripts/benchmark-level2-vs-level3.ts` (performance comparison)

**Validation:**
```bash
npm run test:load
# Should show:
# - Zero timeouts (0%)
# - <100ms API response time
# - 100 bookings exactly
# - available_tickets = 0
# - Final version = 100
```

---

### **Milestone 9: Integration, Testing & Performance Validation**

**Objective:** Complete end-to-end testing, validate no graceful degradation, and optimize performance.

** Tasks:**
1. **Load Test Updates for Async Behavior**
   - Modify `tests/load-test.ts` for async behavior
   - Flow: POST /book → Get JobID → Connect to SSE → Wait for completion
   - Measure API response time (should be <100ms)
   - Measure total booking time (API + worker + SSE)
   - Test with 1000, 5000, 10000 concurrent requests
   - Measure rate limiting effectiveness
   - Monitor circuit breaker state changes

2. **Error Handling Matrix (NO GRACEFUL DEGRADATION)**
   ```
   | Scenario | Worker Behavior | API Response | Client SSE Event |
   |----------|----------------|--------------|------------------|
   | Valid booking | Success | 202 Accepted | confirmed |
   | Event sold out | Fail (no retry) | 202 Accepted | failed (409) |
   | Invalid eventId | Fail | 202 Accepted | failed (404) |
   | Version conflict | Retry (max env.WORKER_MAX_RETRIES) | 202 Accepted | confirmed |
   | Worker crash | Job re-queued | 202 Accepted | processing → confirmed |
   | Rate limit exceeded | N/A | 429 Too Many Requests | N/A |
   | Queue depth exceeded | N/A | 503 Queue Full | N/A |
   | Redis down | Cannot queue job | 503 Service Unavailable (circuit open) | N/A |
   ```
   
   **IMPORTANT - No Graceful Degradation:**
   - If Redis is down, API returns 503 immediately via circuit breaker
   - No fallback to Level 2 synchronous transactions
   - Reason: Prevents database overload during Redis failures
   - Client responsibility: Retry with exponential backoff
   - Monitor Redis health separately

3. **Performance Benchmarks**
   - **Level 2 Baseline:** 200-300 req/s, 800-1500ms latency, 1-2% timeouts
   - **Level 3 Target:** 2000-5000 req/s, <100ms latency, 0% timeouts
   - **Worker Processing:** 200-500ms avg per job
   - **SSE Delivery:** Near-instant after worker completion
   - **Rate Limiting:** 10 req/min per user enforced
   - **Queue Depth:** <50 avg under 10K requests
   - Monitor Redis memory usage and queue depth
   - Monitor version conflict rate (<5% target)
   - Monitor circuit breaker state changes

4. **Configuration Tuning**
   - Adjust `WORKER_CONCURRENCY` based on CPU cores
   - Tune `WORKER_MAX_RETRIES` if conflict rate >5%
   - Adjust `REDIS_QUEUE_MAX_DEPTH` based on load tests
   - Set `CIRCUIT_BREAKER_ERROR_THRESHOLD` appropriately
   - Document production configurations

5. **Documentation Updates**
   - Update `README.md` with Level 3 architecture
   - Document monorepo structure (/apps, /packages)
   - Explain SSE state-check pattern
   - Document "no graceful degradation" decision
   - Document rate limiting and circuit breaker rationale
   - Create troubleshooting guide
   - Add deployment guide for multiple workers

6. **Production Readiness**
   - Add structured logging (Pino)
   - Add metrics collection (queue depth, processing time, conflict rate, circuit breaker state)
   - Set up alerts for high queue depth (>1000)
   - Set up alerts for high conflict rate (>10%)
   - Set up alerts for circuit breaker opening
   - Load testing with production-like configuration
   - Security audit (rate limiting, circuit breaker)

**Expected Output:**
- ✅ Zero race conditions detected
- ✅ Throughput 10x improvement over Level 2
- ✅ Zero timeout errors
- ✅ SSE reliably delivers status updates
- ✅ Load tests pass consistently at 10K requests
- ✅ Redis queue depth stays manageable
- ✅ Rate limiting prevents abuse
- ✅ Circuit breaker protects against Redis failures
- ✅ Complete documentation including no-degradation decision

**Files Modified/Created:**
- `tests/load-test.ts` (update for async + SSE + metrics)
- `tests/stress-test-10k.ts` (new, 10K request test)
- `tests/rate-limit.test.ts` (new, rate limiting validation)
- `docs/level3-performance.md` (performance results)
- `docs/troubleshooting.md` (debugging guide)
- `docs/no-degradation-decision.md` (explains hard fail rationale)
- `docs/configuration-guide.md` (environment variable tuning)
- `README.md` (reorganized for monorepo)

**Validation:**
```bash
# Final validation
npm run test:load
# Expected output:
# 📊 LOAD TEST RESULTS - Level 3 (Queue + Optimistic Locking)
# Total Requests: 10000
# Successful Bookings: 100 (1%)
# Sold Out Rejections: 9800-9900 (98-99%)
# Rate Limited: 0 (0%)
# Timeout Errors: 0 ✅
# API Avg Response: 45ms ✅
# Worker Avg Processing: 350ms ✅
# Race Conditions: 0 ✅
# Retries (version conflict): < 5% of successful bookings
# Circuit Breaker: Closed (healthy)

# Check queue depth during test
docker compose exec redis redis-cli LLEN "bull:booking:waiting"
# Should remain low (< 50) even under 10K requests
```

**Hard Fail Validation:**
```bash
# Test Redis failure scenario
docker compose stop redis

curl -X POST http://localhost:3000/api/v1/bookings \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"eventId": "..."}'
# Expected: 503 Service Unavailable immediately
# NOT: synchronous processing fallback or hanging
# Reason: Circuit breaker opens, protects database

docker compose start redis
# Circuit breaker should close after reset timeout
```

---

## 📊 Success Metrics & KPIs

| Metric | Level 2 | Level 3 Target | Validation Method |
|--------|---------|----------------|-------------------|
| Throughput (req/s) | 200-300 | 5,000-10,000 | Load test (10K req) |
| API Response Time | 800-1500ms | <100ms | Response timing |
| Timeout Rate | 1-2% | 0% | Error counting |
| Race Conditions | 0 | 0 | Database verification |
| Worker Processing | N/A | 200-500ms avg | Job logs |
| Data Integrity | ✅ | ✅ | Booking count vs tickets |
| Scalability | Vertical | Horizontal | Multiple workers |
| Queue Depth | N/A | <50 avg | BullMQ dashboard |
| Job Failure Rate | N/A | <0.1% | BullMQ metrics |
| Version Conflicts | N/A | <5% | Retry count |
| SSE Reliability | N/A | 100% | State check tests |

---

## 🔧 Technical Decisions & Rationale

### Why BullMQ over Bull?
- **BullMQ**: Actively maintained, TypeScript support, better performance
- **Bull**: Legacy, fewer features, slower development
- Decision: Use BullMQ for modern architecture

### Why ioredis over node-redis?
- **BullMQ Requirement**: BullMQ is built specifically on ioredis and requires it for connection handling (see [docs](https://docs.bullmq.io/guide/connections))
- **node-redis**: Officially recommended by Redis for new projects, but NOT compatible with BullMQ
- Decision: Use ioredis because BullMQ mandates it - no choice if we want BullMQ

### Why Monorepo with Turborepo?
- **Separation**: API and Worker as separate apps
- **Shared code**: Database, types, utilities in packages
- **Independent scaling**: Deploy API and Worker separately
- **Clear boundaries**: Enforces clean architecture
- Decision: Reorganized from monolith to monorepo (Milestone 0)

### Why Server-Sent Events over WebSockets?
- **SSE**: HTTP-based, simpler implementation, auto-reconnection
- **WebSockets**: Bidirectional (not needed), more complex
- Decision: SSE fits unidirectional server→client updates, scales better

### Why Optimistic Locking over Distributed Locks?
- **Optimistic**: Higher throughput, scales better, simpler
- **Distributed Locks**: Redlock complexity, lower performance
- Decision: Optimistic locking sufficient for booking tickets

### Why Shared Zod Schemas?
- **Runtime Validation**: Enforces contract between API and Worker
- **Type Safety**: Single source of truth for job data structure
- **Prevents Silent Failures**: Invalid data caught at boundaries
- Decision: Zod schemas in `packages/types` validate producer and consumer

### Retry Strategy
- **Max Attempts**: 3 tries for version conflicts
- **Backoff**: Exponential (100ms → 200ms → 400ms)
- **Rationale**: Balance between success rate and latency

### No Graceful Degradation (Hard Fail)
- **Decision**: If Redis unavailable, return 503. No fallback to Level 2.
- **Rationale**: 
  - Level 2 synchronous transactions would overload database if Redis fails under load
  - Fallback logic adds complexity and new failure modes
  - Monitoring Redis health separately is more reliable
  - Forces infrastructure reliability for Redis
- **Client Handling**: Return 503 → client retries with exponential backoff
- **Alternative**: Use circuit breaker to return 503 immediately, not hang

---

## 📦 Package Structure

```
/apps
  /api
    /src/routes      # HTTP endpoints
    /src/services    # Queue producers, business logic
    /src/middleware  # Auth, rate limiting
    /src/lib         # App-specific utilities
    dist/            # Compiled output
    package.json
    tsconfig.json

  /worker
    /src/processors  # Queue consumers
    /src/lib         # Worker-specific utilities
    dist/
    package.json
    tsconfig.json

/packages
  /database
    /src             # PostgreSQL client, migrations
    package.json     # Exports db client, schemas
    
  /types
    /src             # Zod schemas, TypeScript interfaces
    package.json     # Exports all schemas and types
    
  /lib
    /src             # Redis client, queues, errors, auth
    package.json     # Shared utilities used by both apps

# Root
turbo.json             # Build pipeline definition
package.json           # Workspace root
docker-compose.yml
Dockerfile
```

---

## 🚨 Potential Risks & Mitigations

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Redis becomes bottleneck | Medium | High | Add Redis clustering, increase workers |
| Worker crashes lose jobs | Low | Medium | BullMQ persistence, automatic retry |
| SSE connections overload | Low | Medium | Connection pooling, TTL on jobs |
| Version conflicts too high | Low | Medium | Tune retry strategy, measure conflict rate |
| Increased complexity | High | Medium | Comprehensive testing, documentation |
| Monorepo build issues | Low | Low | Use Turborepo, clear package boundaries |
| BullMQ dashboard security | Medium | High | Add auth middleware to /admin/queues |
| "Fast Worker" race condition | High | High | State check pattern (Milestone 7) |
| Type mismatches API→Worker | Medium | High | Zod schema validation (Milestone 3) |
| Redis failure causes downtime | Low | High | Hard fail (503) + monitoring + alerts |

---

## 📚 Documentation Requirements

Each milestone must include:
1. **README update** with new architecture diagrams
2. **Code comments** explaining Level 3 patterns (use template below)
3. **API Documentation** for new endpoints and SSE usage
4. **Migration guide** for Level 2 → Level 3
5. **Testing guide** with expected outputs
6. **Performance results** comparison Level 2 vs Level 3

**Example Comment Template:**
```typescript
/**
 * Level 3 Implementation: Async Queue-Based Processing with SSE
 * 
 * Architecture: /apps/api, /apps/worker, /packages/*
 * 
 * How it works:
 * 1. API receives POST /book, validates with Zod → returns 202 + jobId
 * 2. BullMQ stores job in Redis, dashboard tracks status
 * 3. Worker pulls job, validates with Zod, uses optimistic locking
 * 4. Version conflict → retry (max 3, exponential backoff)
 * 5. Success/failure published via QueueEvents → SSE notifies client
 * 6. Fast worker handled: state check before subscribe
 * 
 * Trade-offs:
 * ✅ Pros: <100ms API, 10K+ req/s, horizontal scaling, zero timeouts
 * ⚠️ Cons: Eventual consistency, added complexity, Redis dependency
 * 
 * Why monorepo: Clean separation, independent scaling, shared packages
 * Why Zod schemas: Runtime validation prevents API-Worker contract breaches
 * Why QueueEvents: Built-in horizontal scaling, replaces raw Redis Pub/Sub
 * Why no degradation: Hard fail safer than database overload fallback
 * Why BullMQ dashboard: Real-time queue monitoring essential at scale
 * 
 * Service Boundary: Zod schema is the contract. Always validate.
 */
```

---

## ✅ Definition of Done (Level 3 Complete)

### Structural Requirements
- [ ] Milestone 0 complete: Monorepo structure (/apps, /packages) verified
- [ ] All packages build independently: `turbo run build`
- [ ] Docker Compose starts all services: API, Worker, Redis, PostgreSQL
- [ ] Hot-reload works for development

### Functional Requirements
- [ ] POST /api/v1/bookings returns 202 Accepted with jobId (<100ms)
- [ ] GET /api/v1/bookings/status/:jobId supports SSE with proper headers
- [ ] SSE handles "Fast Worker" race condition (check state before subscribe)
- [ ] Worker processes jobs with optimistic locking (no FOR UPDATE)
- [ ] Version conflicts retry automatically (max 3, exponential backoff)
- [ ] QueueEvents used for horizontal scaling (not raw Redis Pub/Sub)
- [ ] BullMQ dashboard functional at /admin/queues with auth

### Data Integrity
- [ ] Load test achieves zero overbookings in 10,000+ concurrent requests
- [ ] Exactly 100 bookings for 100 ticket event
- [ ] available_tickets never negative
- [ ] Final version equals number of bookings

### Type Safety
- [ ] Zod schemas in packages/types validate all job data
- [ ] API validates before queueing (producer validation)
- [ ] Worker validates before processing (consumer validation)
- [ ] Invalid data rejected at boundaries with clear errors

### Performance
- [ ] Zero timeout errors at 10,000 concurrent requests
- [ ] API response time <100ms (p95, p99)
- [ ] Worker processes 5+ jobs concurrently per instance
- [ ] Queue depth remains <50 under load
- [ ] Worker processing time 200-500ms average

### Reliability
- [ ] Worker scales horizontally (tested with 5+ instances)
- [ ] Jobs persist across worker restarts
- [ ] Graceful shutdown completes current jobs
- [ ] No graceful degradation: Returns 503 if Redis unavailable

### Documentation
- [ ] README.md updated with monorepo structure
- [ ] API documentation includes SSE usage examples
- [ ] Migration guide: Level 2 → Level 3
- [ ] Troubleshooting guide covers common issues
- [ ] Performance benchmarks documented (Level 2 vs Level 3)
- [ ] docs/no-degradation-decision.md explains hard fail rationale

### Testing
- [ ] Unit tests for queue producers and consumers
- [ ] Integration test: API → Queue → Worker → SSE
- [ ] Load test validates 10K concurrent requests
- [ ] Test for "Fast Worker" race condition
- [ ] Test Redis failure returns 503 (not fallback)
- [ ] Test version conflict triggers retry

---

## 📝 Implementation Checklist

**Before Starting:**
- [ ] Review this plan thoroughly
- [ ] Create development branch: `git checkout -b level-3-implementation`
- [ ] Ensure Level 2 load tests pass on main: `npm run test:load`
- [ ] Backup database or snapshot current state

**Phase 1 - Foundation:**
- [ ] Milestone 0: Restructure to monorepo
- [ ] Verify existing tests still pass
- [ ] Commit: "Milestone 0: Monorepo restructure complete"

**Phase 2 - Infrastructure:**
- [ ] Milestone 1: Redis & BullMQ setup
- [ ] Verify Redis connection and health
- [ ] Commit: "Milestone 1: Redis infrastructure"

**Phase 3 - Schema:**
- [ ] Milestone 2: Add version column
- [ ] Run migration, verify data
- [ ] Commit: "Milestone 2: Event versioning"

**Phase 4 - Queue:**
- [ ] Milestone 3: Create Zod schemas and queues
- [ ] Test job creation and validation
- [ ] Commit: "Milestone 3: Queue architecture with Zod contracts"

**Phase 5 - Worker:**
- [ ] Milestone 4: Create worker service
- [ ] Test worker processes jobs
- [ ] Commit: "Milestone 4: Worker service"

**Phase 6 - API Migration:**
- [ ] Milestone 5: Migrate booking endpoint to async
- [ ] Test 202 response and job creation
- [ ] Commit: "Milestone 5: Async booking endpoint"

**Phase 7 - SSE:**
- [ ] Milestone 6: SSE with QueueEvents
- [ ] Test QueueEvents broadcast
- [ ] Commit: "Milestone 6: SSE implementation"

**Phase 8 - Race Condition:**
- [ ] Milestone 7: Add state check pattern
- [ ] Test "Fast Worker" scenario
- [ ] Commit: "Milestone 7: Robust SSE race condition fix"

**Phase 9 - Locking:**
- [ ] Milestone 8: Implement optimistic locking
- [ ] Remove FOR UPDATE queries
- [ ] Test version conflicts trigger retry
- [ ] Commit: "Milestone 8: Optimistic locking"

**Phase 10 - Validation:**
- [ ] Milestone 9: Full integration testing
- [ ] Run 10K load test
- [ ] Document performance results
- [ ] Test Redis failure returns 503
- [ ] Commit: "Milestone 9: Integration & performance validation"

**Final Steps:**
- [ ] Complete all documentation
- [ ] Code review (check for any remaining FOR UPDATE)
- [ ] Security audit (BullMQ dashboard auth)
- [ ] Merge to main with PR description linking to this plan
- [ ] Tag release: v3.0.0

---

## 🚫 Common Pitfalls to Avoid

1. **Skipping Milestone 0**: Don't add Redis to monolithic structure. Restructure first.
2. **Removing FOR UPDATE too early**: Keep it until optimistic locking is fully tested (Milestone 5 FIRST)
3. **Wrong milestone order**: Implement optimistic locking (Milestone 5) BEFORE API migration (Milestone 6)
4. **Raw Redis Pub/Sub**: Use BullMQ QueueEvents for horizontal scaling
5. **Missing Zod validation**: Always validate at both producer and consumer
6. **No SSE state check**: Without it, "Fast Worker" race condition causes lost updates
7. **Implementing graceful degradation**: Hard fail is safer and simpler for Level 3
8. **Forgetting auth on BullMQ dashboard**: Exposes sensitive queue data
9. **Not testing with multiple workers**: Single worker hides concurrency bugs
10. **Ignoring version conflict rate**: Should be <5%, tune retry if higher
11. **No circuit breaker**: Redis failures cause cascading timeouts
12. **No rate limiting**: Abuse vectors and queue overflow risks
13. **Dashboard in API**: Security risk and violates separation of concerns
14. **Hardcoded retry config**: Production tuning requires code changes
15. **Incomplete cleanup**: SSE connections leak memory without disconnect handlers

---

### **Milestone 10: Separate BullMQ Dashboard Service**

**Objective:** Create a separate dashboard service for monitoring queues, decoupled from API service. **For production, dashboard should be disabled or heavily secured.**

** Tasks:**
1. **Create Dashboard Service**
   - Create `apps/dashboard/src/index.ts` (dashboard entry point)
   - Mount BullMQ dashboard at root path `/`
   - Add authentication middleware (require admin role)
   - Use shared Redis connection from `packages/lib`

2. **Docker Service Setup**
   ```yaml
   # Add to compose.yaml
   dashboard:
     build:
       context: .
       target: development
     ports:
       - "3001:3001"  # Separate port, not exposed publicly
     environment:
       PORT: 3001
       REDIS_HOST: redis
       # Same Redis config as API/Worker
     depends_on:
       - redis
     profiles:
       - monitoring  # Only start when explicitly requested
   ```

3. **Security Considerations**
   - Dashboard ONLY starts with `--profile monitoring` flag:
   ```bash
   docker compose --profile monitoring up dashboard
   ```
   - In production: Remove dashboard from compose entirely OR add VPN-only access
   - Alternative: Use external monitoring (DataDog, New Relic) instead of dashboard
   - Exposing queue data publicly is a security risk

4. **Authentication Required**
   ```typescript
   // apps/dashboard/src/middleware/require-admin.ts
   app.use('/admin', verifyJWT, requireAdmin);
   ```

**Expected Output:**
- ✅ Dashboard accessible at `http://localhost:3001` (when started)
- ✅ Shows queue depth, job status, processing times
- ✅ Requires admin authentication
- ✅ Does NOT start by default (opt-in with profile)
- ✅ API service does NOT mount dashboard

**Files Modified/Created:**
- `apps/dashboard/src/index.ts` (dashboard entry)
- `apps/dashboard/package.json` (new)
- `compose.yaml` (add dashboard service with profile)
- `apps/dashboard/src/middleware/require-admin.ts` (auth)

**Validation:**
```bash
# Start dashboard explicitly
docker compose --profile monitoring up -d dashboard

# Dashboard should be running
curl http://localhost:3001
# Should show BullMQ dashboard (requires auth)

# Verify API does NOT have dashboard
curl http://localhost:3000/admin/queues
# Should return 404 Not Found

# Stop monitoring services
docker compose --profile monitoring down
```

**Production Recommendation:**
```yaml
# In production compose override, remove dashboard entirely
# Or restrict to internal network only
services:
  dashboard:
    profiles:
      - never  # Never start in production
    # Or use internal network:
    networks:
      - internal
    ports: []  # No external ports
```

---

## 📞 Help & Resources

**If you get stuck:**
1. Check `docs/SPECS.md` - canonical requirements source
2. Review `AGENTS.md` - project context and patterns
3. Check milestone-specific validation steps
4. Run tests after each milestone (don't skip verification)
5. Document any deviations from this plan

**Key Files Reference:**
- Queue config: `packages/lib/src/queues.ts`
- Zod schemas: `packages/types/src/`
- SSE logic: `apps/api/src/routes/booking-status.ts`
- Worker processor: `apps/worker/src/processors/bookingProcessor.ts`
- No degradation doc: `docs/no-degradation-decision.md`

---

*Plan last updated: 2025-11-26*
*Version: 3.0 (incorporates all recommended changes)*
