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
- BullMQ dashboard for monitoring
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
       │                                           │ 2. Create Booking Job
       │                                           │    - Validate request
       │                                           │    - Generate jobId
       │ 5. SSE: booking confirmed/failed          │    - Return 202 Accepted
       │ ◄─────────────────────────────────────────┤
       │                                           │ 3. Push to BullMQ Queue
       │                                           │    (Redis-backed)
       │                                           ▼
       │                                 ┌────────────────────┐
       │                                 │   Redis            │
       │                                 │   BullMQ Queue     │
       │                                 │   + Dashboard UI   │
       │                                 └───────────┬────────┘
       │                                           │
       │                                           │ 4. Worker pulls job
       │                                           ▼
       │                                 ┌────────────────────┐
       │                                 │ Worker Service     │
       │                                 │ (/apps/worker)     │
       │                                 └───────────┬────────┘
       │                                           │
       │                                           │ 5. Process with
       │                                           │    Optimistic Locking
       │                                           │    (version check)
       │                                           ▼
       │                                 ┌────────────────────┐
       │                                 │ PostgreSQL         │
       │                                 │                    │
       │                                 └───────────┬────────┘
       │                                           │
       │                                           │ 6. Update job status
       │                                           ▼
       │                                 ┌────────────────────┐
       └─────────────────────────────────┤  Redis Pub/Sub     │
                                         │  Publish Result    │
                                         └────────────────────┘

/packages
  /database  (Shared PostgreSQL client)
  /types     (Shared TS interfaces)
  /lib       (Shared utilities, errors)
```

---

## 🛣️ Implementation Roadmap: 8 Milestones

### **Milestone 1: Infrastructure Setup - Redis & BullMQ Foundation**

**Objective:** Add Redis service and BullMQ dependencies to enable queue-based processing.

**Tasks:**
1. **Docker Compose Updates**
   - Add Redis service to `compose.yaml`
   - Configure Redis ports (6379)
   - Add Redis healthcheck
   - Add Redis dependency to API service

2. **Package Dependencies**
   ```bash
   npm install bullmq ioredis
   npm install -D @types/ioredis
   ```

3. **Environment Configuration**
   - Add `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD` to `src/lib/env.ts`
   - Update `.env.example` with Redis defaults
   - Add config validation in Zod schema

4. **Redis Connection Setup**
   - Create `src/lib/redis.ts` with connection factory
   - Implement connection retry logic (3 attempts)
   - Export shared Redis instance for BullMQ

**Expected Output:**
- ✅ Redis container starts with Docker Compose
- ✅ Application connects to Redis successfully
- ✅ Healthcheck passes: `docker compose exec redis redis-cli ping`
- ✅ No breaking changes to existing API

**Files Modified/Created:**
- `compose.yaml` (add Redis service + BullMQ dashboard)
- `package.json` (add bullmq, ioredis, @bull-board/api, @bull-board/express)
- `apps/api/src/lib/env.ts` (add Redis env vars)
- `apps/api/src/lib/redis.ts` (new file)
- `packages/database/src/db.ts` (extract from monolith)
- `packages/types/src/index.ts` (extract types)

**Validation:**
```bash
docker compose up -d
# Redis should be healthy
docker compose logs redis
```

---

### **Milestone 2: Database Schema Migration - Event Versioning**

**Objective:** Add optimistic concurrency control by introducing a version column to events.

**Tasks:**
1. **Schema Changes**
   - Add `version INT DEFAULT 0` to `events` table
   - Create migration script in `scripts/migrate-level3.ts`
   - Backfill existing events: `UPDATE events SET version = 0`

2. **Update Database Initialization**
   - Modify `src/lib/db.ts` `initializeDatabase()`
   - Add version column to CREATE TABLE statement
   - Add unique constraint: `UNIQUE(id, version)` for safety

3. **Type Definitions**
   - Update `src/types/index.ts` Event interface
   - Add `version: number` field
   - Update all related type guards

4. **Event Service Updates**
   - Modify `getEventById()` to return version
   - Add `getEventWithVersion()` for worker consumption

**Expected Output:**
- ✅ All events have version = 0 after migration
- ✅ New events get version = 0 automatically
- ✅ Type safety maintained throughout codebase
- ✅ No impact on Level 2 functionality yet

**Files Modified/Created:**
- `packages/database/src/db.ts` (add version column)
- `packages/types/src/index.ts` (add version to types)
- `scripts/migrate-level3.ts` (new migration script)
- `apps/api/src/services/eventService.ts` (add version support)

**Validation:**
```sql
-- After migration
SELECT id, name, version FROM events LIMIT 5;
-- Should show version = 0 for all events
```

---

### **Milestone 3: Job Queue Architecture & Structure**

**Objective:** Define and implement the booking job data structure and queue connections.

**Tasks:**
1. **Job Data Structure Design**
   ```typescript
   interface BookingJobData {
     userId: string;
     eventId: string;
     timestamp: number;
     idempotencyKey?: string; // For Level 4
   }
   ```

2. **Queue Configuration**
   - Create `src/lib/queues.ts`
   - Define queue names: `bookingQueue`, `notificationQueue`
   - Configure BullMQ with Redis connection
   - Set default job options (retry policy, timeout)

3. **Job Producer Logic**
   - Create `src/services/queueService.ts`
   - Implement `createBookingJob()` function
   - Return job ID immediately

4. **Job Consumer Setup**
   - Create `src/workers/bookingWorker.ts`
   - Register queue processor with BullMQ
   - Set concurrency: 5 workers (configurable via env)

**Expected Output:**
- ✅ Can add jobs to queue: `await bookingQueue.add('booking', data)`
- ✅ Jobs appear in Redis: `bull:booking:...`
- ✅ Worker can receive and log jobs
- ✅ Job lifecycle events tracked (waiting, active, completed, failed)

**Files Modified/Created:**
- `packages/lib/src/queues.ts` (queue definitions)
- `apps/api/src/services/queueService.ts` (job producers)
- `apps/worker/src/processors/bookingProcessor.ts` (job consumers)
- `apps/worker/src/index.ts` (worker entry point)
- `apps/api/src/lib/dashboard.ts` (BullMQ dashboard)

**Validation:**
```bash
# Check Redis for queued jobs
docker compose exec redis redis-cli KEYS "bull:*"
```

---

### **Milestone 4: Worker Process & Service Architecture**

**Objective:** Create a separate worker service that processes booking jobs independently.

**Tasks:**
1. **Worker Service Creation**
   - Create `src/workers/index.ts` (worker entry point)
   - Import and start all queue processors
   - Add graceful shutdown handling (SIGTERM, SIGINT)

2. **Docker Service Setup**
   - Add `worker` service to `compose.yaml`
   - Share code volume with API service
   - Set different startup command: `node src/workers/index.ts`
   - Share same environment variables

3. **Worker Implementation**
   - Process job: extract `userId`, `eventId`
   - Call booking logic (refactor from bookingService)
   - Handle success: update job status → trigger notification
   - Handle failure: retry logic, exponential backoff

4. **Monitoring & Logging**
   - Add structured logging: job started, completed, failed
   - Log processing time and queue depth
   - Add health endpoint for worker monitoring

**Expected Output:**
- ✅ Worker container starts and connects to Redis
- ✅ Worker polls queue for jobs
- ✅ Worker can be scaled: `docker compose up -d --scale worker=3`
- ✅ Worker logs show job processing

**Files Modified/Created:**
- `apps/worker/src/index.ts` (worker entry)
- `apps/worker/src/processors/bookingProcessor.ts` (processing logic)
- `compose.yaml` (add worker service)
- `apps/api/src/middleware/worker-health.ts` (health monitoring)

**Validation:**
```bash
# Start worker
docker compose up -d worker
# Check worker logs
docker compose logs -f worker
# Should see "Worker listening for booking jobs..."
```

---

### **Milestone 5: API Endpoint Migration to Async Pattern**

**Objective:** Transform the booking endpoint from synchronous to asynchronous.

**Tasks:**
1. **Endpoint Logic Refactor**
   - Keep validation logic (Zod schema, auth)
   - Remove direct call to `bookingService.createBooking()`
   - Add call to `queueService.createBookingJob()`

2. **Response Format Change**
   - Change status from `201` → `202 Accepted`
   - Response body:
   ```json
   {
     "success": true,
     "data": {
       "jobId": "bull:booking:123",
       "status": "queued",
       "estimatedTime": "< 5 seconds"
     },
     "message": "Booking request accepted. Listen on SSE endpoint for updates."
   }
   ```

3. **SSE Endpoint Creation**
   - Create `GET /api/v1/bookings/status/:jobId`
   - Implement Server-Sent Events with proper headers
   - Handle client disconnections
   - Send events: `queued`, `processing`, `confirmed`, `failed`

4. **Update Tests**
   - Update unit tests for new async behavior
   - Add test for job queueing
   - Add test for SSE endpoint

**Expected Output:**
- ✅ API returns in <100ms consistently
- ✅ Job ID returned to client immediately
- ✅ Job appears in Redis queue
- ✅ Worker picks up job within seconds

**Files Modified/Created:**
- `apps/api/src/routes/bookings.ts` (refactor POST endpoint via queue)
- `apps/api/src/routes/booking-status.ts` (new SSE endpoint)
- `apps/api/src/services/queueService.ts` (enhance job creation)

**Validation:**
```bash
curl -X POST http://localhost:3000/api/v1/bookings \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"eventId": "..."}'
# Expected: 202 Accepted with jobId
```

---

### **Milestone 6: Server-Sent Events (SSE) Implementation**

**Objective:** Provide real-time status updates to clients via Server-Sent Events.

**Tasks:**
1. **SSE Endpoint Setup**
   ```typescript
   // GET /api/v1/bookings/status/:jobId
   res.writeHead(200, {
     'Content-Type': 'text/event-stream',
     'Cache-Control': 'no-cache',
     'Connection': 'keep-alive',
   });
   ```

2. **Event Types**
   - `event: queued` - Job received, waiting for worker
   - `event: processing` - Worker picked up job
   - `event: confirmed` - Booking successful (with bookingId)
   - `event: failed` - Booking failed (reason: sold out, error)
   - `event: error` - System error

3. **Redis Pub/Sub Integration**
   - Worker publishes results to Redis channel
   - SSE endpoint subscribes to channel
   - Forward messages to connected clients

4. **Client Example**
   - Create `examples/sse-client.html`
   - Demonstrate EventSource API usage
   - Show connection, reconnection, and status updates

**Expected Output:**
- ✅ Client can connect to SSE endpoint
- ✅ Real-time status updates delivered
- ✅ Automatic reconnection on disconnect
- ✅ Multiple clients can listen to same job

**Files Modified/Created:**
- `apps/api/src/routes/booking-status.ts` (SSE implementation)
- `apps/api/src/services/notificationService.ts` (pub/sub logic)
- `examples/sse-client.html` (client example)
- BullMQ dashboard mounted at `/admin/queues`

**Validation:**
```javascript
const eventSource = new EventSource('/api/v1/bookings/status/{jobId}');
eventSource.onmessage = (event) => {
  console.log('Booking status:', JSON.parse(event.data));
};
```

---

### **Milestone 7: Optimistic Locking Implementation in Workers**

**Objective:** Replace `FOR UPDATE` with optimistic locking using version numbers.

**Tasks:**
1. **Worker Processing Logic**
   ```typescript
   async function processBooking(job: Job) {
     const { userId, eventId } = job.data;
     
     // Read event WITH version
     const event = await sql`SELECT * FROM events WHERE id = ${eventId}`;
     const currentVersion = event.version;
     
     // Try to update with version check
     const result = await sql`
       UPDATE events
       SET available_tickets = available_tickets - 1,
           version = version + 1
       WHERE id = ${eventId} 
         AND version = ${currentVersion}
         AND available_tickets > 0
     `;
     
     // Check if update succeeded
     if (result.count === 0) {
       // Version mismatch or sold out - retry or fail
       throw new BookingError('EVENT_SOLD_OUT_OR_CONFLICT');
     }
     
     // Create booking record
     await sql`INSERT INTO bookings ...`;
   }
   ```

2. **Retry Strategy**
   - On version conflict: retry up to 3 times
   - Exponential backoff: 100ms, 200ms, 400ms
   - On max retries: fail job with permanent error

3. **Race Condition Testing**
   - Run 1000 concurrent requests
   - Monitor for "version conflict" errors (expected)
   - Verify exactly 100 bookings created
   - Verify available_tickets = 0 (not negative)

4. **Performance Comparison**
   - Measure throughput vs Level 2
   - Verify <100ms API response time
   - Check worker processing time (~500ms avg)

**Expected Output:**
- ✅ No `FOR UPDATE` queries in code
- ✅ Version checking prevents overbooking
- ✅ Retry logic handles conflicts gracefully
- ✅ Throughput 5-10x higher than Level 2

**Files Modified/Created:**
- `apps/worker/src/processors/bookingProcessor.ts` (optimistic locking logic)
- `apps/worker/src/utils/optimisticLock.ts` (retry utilities)
- `packages/database/src/events.ts` (version update queries)

**Validation:**
```bash
npm run test:load
# Should show:
# - Zero timeouts
# - <100ms API response
# - 100 bookings exactly
# - available_tickets = 0
```

---

### **Milestone 8: Integration, Testing & Performance Validation**

**Objective:** Complete end-to-end testing and optimize performance.

**Tasks:**
1. **Load Test Updates**
   - Modify `tests/load-test.ts` for async behavior
   - Add SSE listener to wait for completion
   - Measure API response time (should be <100ms)
   - Measure total booking time (API + worker)

2. **Error Handling Matrix**
   | Scenario | Expected Behavior |
   |----------|-------------------|
   | Valid booking | 202 → processing → confirmed |
   | Event sold out | 202 → processing → failed (409) |
   | Invalid eventId | 202 → processing → failed (404) |
   | Version conflict | 202 → processing → retry → confirmed |
   | Worker crash | Job re-queued automatically |
   | Redis down | Graceful degradation to Level 2 |

3. **Performance Benchmarks**
   - **Level 2 Baseline:** 200-300 req/s, 800-1500ms latency, 1-2% timeouts
   - **Level 3 Target:** 2000-5000 req/s, <100ms latency, 0% timeouts
   - Test with 1000, 5000, 10000 concurrent requests
   - Monitor Redis memory usage and queue depth

4. **Documentation Updates**
   - Update `README.md` with Level 3 architecture
   - Add deployment guide for multiple workers
   - Document monitoring and debugging
   - Create troubleshooting guide

**Expected Output:**
- ✅ Zero race conditions detected
- ✅ Throughput 10x improvement
- ✅ Zero timeout errors
- ✅ Load tests pass consistently
- ✅ Complete documentation

**Files Modified/Created:**
- `tests/load-test.ts` (update for 10,000+ requests, SSE)
- `docs/level3-performance.md` (performance results)
- `docs/troubleshooting.md` (debugging guide)
- `README.md` (reorganized for monorepo structure)

**Validation:**
```bash
# Final validation
npm run test:load
# Expected output:
# 📊 LOAD TEST RESULTS - Level 3 (Queue + Optimistic Locking)
# Successful Bookings: 100/100 (100%)
# Timeout Errors: 0/1000 (0%)
# Avg API Response: 45ms ✅
# Race Conditions: 0 ✅
```

---

## 📊 Success Metrics & KPIs

| Metric | Level 2 | Level 3 Target | Validation Method |
|--------|---------|----------------|-------------------|
| Throughput (req/s) | 200-300 | 5,000-10,000 | Load test (10K req) |
| API Response Time | 800-1500ms | <100ms | Response timing |
| Timeout Rate | 1-2% | 0% | Error counting |
| Race Conditions | 0 | 0 | Database verification |
| Worker Processing | N/A | 500ms avg | Job logs |
| Data Integrity | ✅ | ✅ | Booking count vs tickets |
| Scalability | Vertical | Horizontal | Multiple workers |
| Queue Depth | N/A | Real-time | BullMQ dashboard |
| Job Failure Rate | N/A | <0.1% | BullMQ metrics |

---

## 🔧 Technical Decisions & Rationale

### Why BullMQ over Bull?
- **BullMQ**: Actively maintained, TypeScript support, better performance
- **Bull**: Legacy, fewer features, slower development
- Decision: Use BullMQ for modern architecture

### Why ioredis over node-redis?
- **BullMQ Requirement**: BullMQ is built specifically on ioredis and requires it for connection handling (see [docs](https://docs.bullmq.io/guide/connections))
- **node-redis**: Officially recommended by Redis for new projects, but NOT compatible with BullMQ
- **ioredis**: The ioredis team recommends node-redis for new projects, creating confusion
- Decision: Use ioredis because BullMQ mandates it - no choice if we want BullMQ
- **Future Note**: If BullMQ adds node-redis support in the future, we can re-evaluate

### Why Monorepo with Turborepo?
- **Separation**: API and Worker as separate apps
- **Shared code**: Database, types, utilities in packages
- **Independent scaling**: Deploy API and Worker separately
- **Clear boundaries**: Enforces clean architecture
- Decision: Reorganize from monolith to monorepo structure

### Why Server-Sent Events over WebSockets?
- **SSE**: HTTP-based, simpler implementation, auto-reconnection
- **WebSockets**: Bidirectional (not needed), more complex
- Decision: SSE fits our unidirectional server→client updates

### Why Optimistic Locking over Distributed Locks?
- **Optimistic**: Higher throughput, scales better, simpler
- **Distributed Locks**: Redlock complexity, lower performance
- Decision: Optimistic locking sufficient for booking tickets

### Retry Strategy
- **Max Attempts**: 3 tries for version conflicts
- **Backoff**: Exponential (100ms → 200ms → 400ms)
- **Rationale**: Balance between success rate and latency
- **No degradation**: Hard fail if Redis unavailable (no Level 2 fallback)

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

---

## 📚 Documentation Requirements

Each milestone must include:
1. **README update** with new endpoints
2. **Code comments** explaining Level 3 patterns
3. **Migration guide** for Level 2 → Level 3
4. **Testing guide** with expected outputs
5. **Performance results** comparison

**Example Comment Template:**
```typescript
/**
 * Level 3 Implementation: Monorepo + Queue-Based Async Processing
 * 
 * Architecture: /apps/api, /apps/worker, /packages/*
 * 
 * How it works:
 * 1. API receives POST /book, validates, creates job → returns 202
 * 2. BullMQ stores job in Redis, dashboard tracks status
 * 3. Worker pulls job, uses optimistic locking (version check)
 * 4. Version conflict → retry (max 3, exponential backoff)
 * 5. Success/failure published → SSE notifies client
 * 6. In-memory SSE (no persistence), BullMQ dashboard at /admin/queues
 * 
 * Trade-offs:
 * ✅ Pros: <100ms API, 10K+ req/s, horizontal scaling, zero timeouts
 * ⚠️ Cons: Eventual consistency, added complexity, Redis dependency
 * 
 * Why monorepo: Clean separation, independent scaling, shared packages
 * Why no degradation: Forces Redis reliability, simpler architecture
 * Why BullMQ dashboard: Real-time queue monitoring essential at scale
 */
```

---

## ✅ Definition of Done (Level 3 Complete)

- [ ] All 8 milestones completed
- [ ] Project reorganized into monorepo structure (/apps, /packages)
- [ ] Load test achieves <100ms API response time
- [ ] Zero overbookings in 10,000+ concurrent request tests
- [ ] Worker processes scale horizontally (tested with 5+ workers)
- [ ] SSE status updates work end-to-end (in-memory)
- [ ] No `FOR UPDATE` queries in codebase
- [ ] BullMQ dashboard functional at /admin/queues
- [ ] No graceful degradation (hard fail if Redis down)
- [ ] All existing functionality preserved (auth, events, cancellations)
- [ ] New load test script validates async behavior with SSE
- [ ] Documentation complete: README (monorepo structure), API docs, troubleshooting
- [ ] Performance benchmarks documented (Level 2 vs Level 3 at 10K req)
- [ ] Code review and security audit passed

---

## 📝 Next Steps

1. **Review this plan** - Verify approach aligns with project goals
2. **Set up development branch** - `git checkout -b level-3-implementation`
3. **Implement Milestone 1** - Start with Redis infrastructure
4. **Test each milestone** - Run load tests after each major change
5. **Document progress** - Keep detailed notes for future levels
6. **Get feedback** - Review performance metrics after Milestone 7
7. **Merge to main** - After all milestones and testing complete

---

## ✅ Decisions Summary (Confirmed)

✅ **No backward compatibility** - APIs fully replaced with Level 3 (202 Accepted)  
✅ **10,000+ concurrent requests** - Load testing target for validation  
✅ **No graceful degradation** - Hard fail (503) if Redis unavailable  
✅ **BullMQ dashboard included** - Admin UI at `/admin/queues`  
✅ **No SSE persistence** - In-memory connections only  
✅ **Monorepo structure** - `/apps/api`, `/apps/worker`, `/packages/*`  
✅ **Strictly Level 3** - No Level 4 features (will plan later)  

**Plan complete and ready for implementation!**
