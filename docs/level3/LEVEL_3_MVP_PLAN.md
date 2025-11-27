# TicketHive Level 3 MVP Plan

**For Frontend Developers Taking on Their First Backend Project**

## 🎯 MVP Goal: Async Booking That Works End-to-End

**Current State (Level 2):**
- Synchronous API with `FOR UPDATE` locking
- 1-2% timeout rate under load
- Works but slow under flash sale conditions

**MVP Target State:**
- Async request processing via BullMQ queue
- <100ms API response (202 Accepted)
- Worker processes bookings in background
- Optimistic locking prevents overbookings
- SSE delivers status updates reliably
- **Zero overbookings verified**

**What You're Building:** The core async flow - enough to test and learn, not yet production-hardened.

---

## 📋 MVP Architecture (What You'll Build)

```
┌─────────────┐      1. POST /book      ┌────────────────────┐
│             │ ──────────────────────► │                    │
│   Client    │    (with payload)       │  API Service       │
│             │                         │  (/apps/api)       │
└──────┬──────┘                         └───────────┬────────┘
       │                                           │
       │                                           │ 2. Validate request
       │                                           │ 3. Create booking job
       │ 6. SSE: Check State + Subscribe           │ 4. Return 202 + jobId
       │ ◄─────────────────────────────────────────┤ 5. Push to Redis Queue
       │                                           ▼
       │                                 ┌────────────────────┐
       │                                 │   Redis            │
       │                                 │   BullMQ Queue     │
       │                                 └───────────┬────────┘
       │                                           │
       │                                           │ 7. Worker pulls job
       │                                           ▼
       │                                 ┌────────────────────┐
       │                                 │ Worker Service     │
       │                                 │ (/apps/worker)     │
       │                                 └───────────┬────────┘
       │                                           │
       │                                           │ 8. Optimistic Locking
       │                                           │     (version check)
       │                                           │ 9. Database update
       │                                           ▼
       │                                 ┌────────────────────┐
       │                                 │ PostgreSQL         │
       │                                 │                    │
       │                                 └───────────┬────────┘
       │                                           │
       │                                           │ 10. Publish via QueueEvents
       │                                           ▼
       │                                 ┌────────────────────┐
       └─────────────────────────────────┤  QueueEvents       │
                                         │  (Redis Streams)   │
                                         └────────────────────┘

/packages
  /database  (Shared PostgreSQL client)
  /types     (Shared Zod schemas + TS types)
  /lib       (Shared Redis client, errors)
```

**What's NOT in MVP:**
- ❌ Rate limiting (users could spam API)
- ❌ Circuit breaker (Redis failures cause hangs)
- ❌ Queue backpressure (Redis could overload)
- ❌ Separate dashboard (use Redis CLI for debugging)
- ❌ Production metrics (basic logs only)

**Mental Model:** Think of this like building a React app without authentication first - get the core flow working, then add protection.

---

## 📖 Why These Decisions Matter for Frontend Devs

### The "Fast Worker" Problem You'll Solve

Imagine this timeline:
```
0ms:  You click "Book Ticket" → API creates job → Returns 202
10ms: Worker magically finishes instantly → Publishes "completed" event
50ms: Your browser receives 202 → Starts connecting to SSE
60ms: SSE connection established → Waiting for updates...

→ BUG: The event already happened! You wait forever.
```

**Your Solution:** Check job state BEFORE subscribing
```typescript
// GET /api/v1/bookings/status/:jobId
const job = await bookingQueue.getJob(jobId);

if (job.returnvalue) {
  // Worker already finished! Send result immediately
  res.write(`event: confirmed\ndata: {...}\n\n`);
  return res.end(); // Done!
}

// Only subscribe if still processing
const queueEvents = new QueueEvents('booking');
queueEvents.on('completed', (event) => { /* ... */ });
```

**Why This Matters:** You prevent infinite loading spinners - a classic UX problem in async systems.

---

## 🛣️ MVP Implementation Roadmap: 7 Milestones

### **Milestone 0: Monorepo Restructure - Foundation**

**Objective:** Reorganize existing Level 2 code before adding complexity.

** Tasks:**
1. Create `/apps/api`, `/apps/worker`, `/packages/database`, `/packages/types`, `/packages/lib`
2. Move existing code to new structure
3. Update imports to use package names (e.g., `@ticket-hive/types`)
4. Add `turbo.json` for build orchestration
5. Verify existing Level 2 tests still pass

**Validation:**
```bash
npm run test:load
# Should show same results as before:
# - 100 bookings created
# - 0 overbookings
# - 1-2% timeout rate (expected for Level 2)
```

**Time Estimate:** 2-4 hours
**Difficulty:** Medium (mostly moving files)

---

### **Milestone 1: Redis Setup - Add Queue Infrastructure**

**Objective:** Add Redis so BullMQ has somewhere to store jobs.

** Tasks:**
1. Add Redis service to Docker Compose
2. Install dependencies: `npm install bullmq ioredis`
3. Create Redis connection in `packages/lib/src/redis.ts`
4. Add Redis environment variables
5. Test Redis connection

**Validation:**
```bash
docker compose up -d redis
docker compose exec redis redis-cli ping
# Should return: PONG
```

**Time Estimate:** 1-2 hours
**Difficulty:** Easy (mostly configuration)

**Key Learning:** Redis is just a fast key-value store. BullMQ uses it as a queue backend.

---

### **Milestone 2: Database Migration - Add Version Column**

**Objective:** Enable optimistic locking by adding version numbers to events.

** Tasks:**
1. Add `version INT DEFAULT 0` to `events` table
2. Backfill existing events: `UPDATE events SET version = 0`
3. Update TypeScript types to include `version: number`
4. Add unique constraint: `UNIQUE(id, version)`

**Validation:**
```sql
SELECT id, name, version FROM events LIMIT 5;
-- Should show version = 0 for all
```

**Time Estimate:** 1 hour
**Difficulty:** Easy (SQL migration)

**Key Learning:** Version numbers replace database locks. Each update increments version → prevents race conditions.

---

### **Milestone 3: Queue Architecture - Define Job Structure**

**Objective:** Define what data flows between API and Worker.

** Tasks:**
1. Create Zod schema for booking job:
```typescript
export const BookingJobSchema = z.object({
  userId: z.string().uuid(),
  eventId: z.string().uuid(),
  timestamp: z.number().int().positive(),
});
```
2. Create queue configuration in `packages/lib/src/queues.ts`
3. Set retry options: 3 attempts, exponential backoff
4. Create job producer (API) and consumer (Worker) skeletons

**Validation:**
```typescript
// Should be able to:
const job = await bookingQueue.add('booking', validData);
// Job appears in Redis
```

**Time Estimate:** 2-3 hours
**Difficulty:** Medium (new concepts: Zod, BullMQ)

**Key Learning:** Zod is like prop-types but for API-Worker contracts. Validates at runtime.

---

### **Milestone 4: Worker Service - Create Skeleton**

**Objective:** Worker can connect to queue and receive jobs (but not process yet).

** Tasks:**
1. Create `apps/worker/src/index.ts` entry point
2. Register queue processor with BullMQ
3. Log when jobs are received
4. Add graceful shutdown (completes current job before exit)

**Validation:**
```bash
docker compose up -d worker
docker compose logs -f worker
# Should see: "Worker listening for booking jobs..."
# When job added: "Received job bull:booking:123"
```

**Time Estimate:** 1-2 hours
**Difficulty:** Easy (follow BullMQ docs)

**Key Learning:** Worker is just a Node.js process that polls Redis for jobs.

---

### **Milestone 5: Optimistic Locking - Worker Booking Logic**

**Objective:** Worker actually processes bookings with version checking.

** Tasks:**
1. Implement booking logic in `apps/worker/src/processors/bookingProcessor.ts`:
```typescript
async function processBooking(job: Job<BookingJobData>) {
  const { userId, eventId } = job.data;
  
  // Read event (NO LOCK!)
  const event = await sql`SELECT * FROM events WHERE id = ${eventId}`;
  
  // Optimistic update: version must match
  const result = await sql`
    UPDATE events
    SET available_tickets = available_tickets - 1,
        version = version + 1
    WHERE id = ${eventId} 
      AND version = ${event.version}
      AND available_tickets > 0
    RETURNING id, version
  `;
  
  if (result.count === 0) {
    throw new Error('Sold out or version conflict');
  }
  
  // Create booking
  await sql`INSERT INTO bookings ...`;
}
```
2. Set retry attempts: 3 tries with exponential backoff
3. Test with single worker
4. Test with multiple workers (scale: `docker compose up --scale worker=3`)

**Validation:**
```bash
npm run test:load
# Should show:
# - Zero timeouts (0%) ✨
# - <100ms API response (but still using Level 2)
# - Worker still processes if jobs exist

# Test worker directly:
# 1. Create job manually in Redis
# 2. Check worker logs
# 3. Verify booking created
# 4. Verify version incremented
```

**Time Estimate:** 3-4 hours
**Difficulty:** Hard (first time with optimistic locking)

**Key Learning:** If version changed between read and write → someone else booked first → retry.

---

### **Milestone 6: API Migration - Async Booking Endpoint**

**Objective:** API no longer processes bookings directly - just queues them.

** Tasks:**
1. Change POST `/api/v1/bookings` to return 202 instead of 201
2. Call `queueService.createBookingJob()` instead of `bookingService.createBooking()`
3. Return job ID and status URL:
```json
{
  "success": true,
  "data": {
    "jobId": "bull:booking:123",
    "status": "queued",
    "statusUrl": "/api/v1/bookings/status/:jobId",
    "estimatedTimeSeconds": 5
  },
  "message": "Booking request accepted"
}
```
4. Implement SSE endpoint: GET `/api/v1/bookings/status/:jobId`
5. Add "Fast Worker" state check (critical!):
```typescript
const job = await bookingQueue.getJob(jobId);

// If already done, send result immediately
if (job.returnvalue) {
  res.write(`event: confirmed\n`);
  return res.end();
}

// Otherwise subscribe for updates
queueEvents.on('completed', (event) => { /* ... */ });
```

**Validation:**
```bash
curl -X POST http://localhost:3000/api/v1/bookings \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"eventId": "..."}'
# Expected: 202 Accepted with jobId
# Response time: <100ms ⚡

docker compose logs worker
# Should show: Processing job bull:booking:123

# Connect to SSE
curl http://localhost:3000/api/v1/bookings/status/bull:booking:123
# Should receive: event: confirmed with booking data
```

**Time Estimate:** 3-4 hours
**Difficulty:** Hard (SSE is new concept)

**Key Learning:** SSE is like WebSockets but simpler: server → client only, HTTP-based.

---

## ✅ MVP Success Criteria

Run this after completing Milestone 6:

```bash
npm run test:load
```

**Expected Output:**
```
📊 LOAD TEST RESULTS - Level 3 MVP

📈 Request Metrics:
  Total Requests: 1000
  API Response: 202 Accepted (100%)
  Response Time: 45ms avg ⚡ (was 800-1500ms)
  Timeouts: 0 ✅ (was 1-2%)

🎟️  Booking Integrity:
  Expected Bookings: 100
  Actual Bookings: 100 ✅
  Available Tickets: 0 ✅
  Final Version: 100 ✅

📡 SSE Reliability:
  Status Updates Delivered: 100% ✅
  Fast Worker Race Conditions: 0 ✅

✅ MVP COMPLETE: Async booking works end-to-end!
```

**If you see this, you've successfully implemented Level 3 MVP!**

---

## 📊 MVP vs Production Comparison

| Feature | MVP (What You Built) | Production (Next Steps) |
|---------|---------------------|------------------------|
| **Async Booking** | ✅ Works (<100ms) | ✅ Same |
| **Optimistic Locking** | ✅ Prevents overbookings | ✅ Same |
| **SSE Notifications** | ✅ Reliable with state check | ✅ Same |
| **Rate Limiting** | ❌ Not implemented | 🛡️ Required (prevent abuse) |
| **Circuit Breaker** | ❌ Not implemented | 🛡️ Required (fail fast) |
| **Queue Backpressure** | ❌ Not implemented | 🛡️ Required (prevent overload) |
| **Dashboard** | ❌ Use Redis CLI | 📊 Web UI for monitoring |
| **Logging** | ❌ Basic console.logs | 📊 Structured logs (Pino) |
| **Metrics** | ❌ Manual checks | 📊 Automated dashboards |

**MVP is like:** Your React app works locally, but has no authentication or error monitoring.
**Production is:** Deployed with auth, monitoring, and Sentry for errors.

---

## 🎓 Key Concepts for Frontend Developers

### 1. **Queues = Background Jobs**
Think of BullMQ like `setTimeout`, but:
- Persists across server restarts (Redis stores jobs)
- Multiple workers can process in parallel
- Built-in retry on failure

### 2. **Optimistic Locking = No Locks**
Instead of locking database rows (`FOR UPDATE`), you:
- Read the current version (e.g., version: 5)
- Update only if version still 5
- If version changed → someone else modified → retry

Trade-off: Higher throughput, but some retries needed.

### 3. **SSE = Server-Sent Events**
Like WebSockets, but simpler:
- HTTP-based (works through proxies)
- Server → Client only (no need for bidirectional)
- Auto-reconnect in browsers

### 4. **"Fast Worker" Race Condition**
Classic async bug: worker finishes before client subscribes.

Solution: Check state BEFORE subscribing → immediately return if already done.

---

## 🚀 Next Steps After MVP

Once MVP is working, move to Production Hardening:

**Document:** `docs/level3/LEVEL_3_PRODUCTION_PLAN.md`

**What you'll add:**
- Rate limiting (prevent abuse)
- Circuit breaker (Redis fails fast)
- Queue backpressure (prevent overload)
- Separate dashboard (monitoring UI)
- Structured logging & metrics (observability)

**Goal:** Take "it works" to "ready for flash sale traffic"

---

## 📞 Getting Help

**Stuck? Check these resources:**
1. **`AGENTS.md`** - Project context and patterns
2. **`docs/SPECS.md`** (Level 3 section) - Specification requirements
3. **Error logs** - Always check `docker compose logs`
4. **Redis CLI** - `docker compose exec redis redis-cli KEYS "bull:*"`

**Common MVP Issues:**
- "Job not found" → Worker not listening or queue name mismatch
- SSE not connecting → Check route path and headers
- Version conflicts > 10% → Increase retry attempts
- Still seeing timeouts → Verify API returns 202, not 201

---

**Plan Version:** 3.1 (MVP Focused)
**Target Audience:** Frontend developers new to backend systems
**Goal:** Build core async booking flow without production complexity