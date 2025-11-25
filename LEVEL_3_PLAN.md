# Level 3 Implementation Plan: Queue-Based Async Processing

## 🎯 Objective

Transform the synchronous booking system into an **async, queue-based architecture** using BullMQ (Redis) to handle 10,000+ concurrent requests without database timeouts, while maintaining 100% data integrity through **optimistic concurrency control**.

## 📊 Current State Analysis (Level 2)

**Strengths:**
- ✅ 100% data integrity (zero overbookings)
- ✅ Transactions with `FOR UPDATE` prevent race conditions
- ✅ Clear error handling (business vs infrastructure errors)
- ✅ Works correctly under 1000 concurrent requests

**Limitations:**
- ❌ ~1-2% timeout rate under extreme load
- ❌ High latency (800-1500ms avg response time)
- ❌ Requests serialize on database locks
- ❌ Not scalable beyond 1000-2000 concurrent requests
- ❌ Poor user experience (users wait for processing)

**Level 3 Goals:**
- 🎯 Handle 10,000+ concurrent requests
- 🎯 Eliminate timeout errors (no waiting on DB locks)
- 🎯 Immediate API response (< 100ms)
- 🎯 Better throughput with multiple workers
- 🎯 Async status tracking via Server-Sent Events (SSE)
- 🎯 100% data integrity maintained (no overbookings)

---

## 🤔 Implementation Decision: Server-Sent Events (SSE) vs WebSockets

**After careful evaluation, we've chosen Server-Sent Events (SSE) over WebSockets for Level 3.**

### Why Server-Sent Events?

The Level 3 spec originally called for WebSockets, but SSE is actually a better fit for this use case:

#### ✅ SSE Advantages for Booking Status Updates:

1. **Unidirectional Communication Pattern**
   - Perfect fit: Server pushes booking status updates → Client (one-way)
   - Booking flow doesn't require client-to-server communication after the initial request
   - Simpler mental model and architecture

2. **Standard HTTP Protocol**
   - Uses existing HTTP infrastructure (no special ports or protocols)
   - Works through proxies, firewalls, and load balancers without configuration
   - No need for WebSocket upgrade handshake
   - Automatic reconnection and retry logic built into browsers

3. **Simpler Implementation & Maintenance**
   - No additional WebSocket library dependencies
   - Uses standard Express.js request/response flow
   - Easier debugging with familiar HTTP tools (curl, Postman, browser dev tools)
   - Less boilerplate code for connection management

4. **Better Resource Management**
   - Each SSE connection is just a long-lived HTTP request
   - Automatic cleanup when clients disconnect
   - No persistent connections to manage when no clients are connected
   - Lower memory overhead per connection

5. **Built-in Browser Support**
   - Native `EventSource` API in all modern browsers
   - Automatic reconnection with `Last-Event-ID` tracking
   - No client-side libraries needed

6. **Production-Ready**
   - Used by Slack, Twitter, and other major platforms for real-time features
   - Scales well with standard HTTP infrastructure
   - Better monitoring with existing HTTP metrics

#### ❌ When WebSockets Would Be Better:

WebSockets are superior for **bidirectional communication** where:
- Client needs to send frequent updates to server (chat, collaborative editing)
- Real-time multiplayer games
- Complex protocol with many message types in both directions

These don't apply to our booking status use case.

#### 📊 Comparison:

| Aspect | Server-Sent Events | WebSockets |
|--------|-------------------|------------|
| **Communication** | Server → Client (one-way) | Bidirectional |
| **Protocol** | HTTP | WebSocket (ws://) |
| **Implementation** | Simple (HTTP) | More complex |
| **Dependencies** | None (native HTTP) | `ws` library + client code |
| **Connection** | Stateless HTTP | Stateful persistent |
| **Best For** | Status updates, feeds | Chat, games, collaboration |
| **Maintenance** | Low | Medium |

**Conclusion**: SSE is the right tool for Level 3's unidirectional status update requirement.

---

## 🏗️ Architecture Overview (Level 3)

```
┌─────────────────────────────────────────────────────────────┐
│                    API Layer (Express)                      │
│  • Validate request                                         │
│  • Create PENDING booking in DB                             │
│  • Push job to BullMQ queue                                 │
│  • Return 202 Accepted immediately                          │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                  Redis Queue (BullMQ)                       │
│  • Stores booking jobs (userId, eventId, bookingId)        │
│  • Manages job priorities and retries                      │
│  • Provides monitoring UI (Arena)                          │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                 Worker Pool (1-5 processes)                │
│  • Pulls jobs from queue                                   │
│  • Process with optimistic locking (version column)        │
│  • Update booking status (PENDING → CONFIRMED/FAILED)      │
│  • Emit Server-Sent Events (SSE) status updates           │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│              PostgreSQL (with version column)               │
│  • Tables: events, bookings                               │
│  • Optimistic locking: version column with UPDATE check    │
└─────────────────────────────────────────────────────────────┘
```

---

## 📋 Milestone Breakdown

### **Milestone 1: Infrastructure Setup** 
*Foundation for queue-based architecture*

#### Tasks:
1. **Add Redis to Docker Compose**
   - Add `redis` service to `compose.yaml`
   - Configure Redis persistence (AOF + RDB)
   - Add Redis monitoring with RedisInsight

2. **Install BullMQ dependencies**
   - Add `bullmq`, `ioredis` to package.json
   - Add `@types/bullmq` for TypeScript support

3. **Create Redis connection utility**
   - `src/lib/redis.ts` - Singleton Redis client
   - Handle connection errors and reconnection logic
   - Add health check for Redis

4. **Database Schema Updates**
   - Add `version` column to `events` table (default: 1)
   - Add `status` column to `bookings` table: PENDING, RESERVING, CONFIRMED, FAILED, CANCELLED (see FAQ below for why)
   - Add indexes on new columns
   
   **FAQ - Why the status column?**
   
   **Q: Why multiple booking statuses (PENDING, RESERVING, CONFIRMED, FAILED, CANCELLED)?**
   
   **A**: In Level 3's async architecture, a booking goes through a lifecycle:
   
   - **PENDING**: Booking created, job queued (immediate API response)
   - **RESERVING**: Worker picked up job, processing transaction
   - **CONFIRMED**: Successfully booked (tickets decremented, booking confirmed)
   - **FAILED**: Couldn't book (sold out, version conflict, or error)
   - **CANCELLED**: User cancelled after confirmation
   
   This allows clients to track progress and the system to retry failures. In Level 2 (sync), you didn't need this because everything happened in one transaction.

5. **Prepare existing code**
   - Rename current `bookingService` to `bookingService.transactional.ts`
   - Keep as reference for comparison
   - Create new modular structure for Level 3

#### Acceptance Criteria:
- [ ] Redis container starts successfully with `docker compose up -d`
- [ ] Redis client connects without errors
- [ ] Database migration runs successfully (all new columns added)
- [ ] Application starts without breaking existing functionality

**Estimated Duration:** 2-3 hours

---

### **Milestone 2: Queue Infrastructure**
*Core BullMQ implementation*

#### Tasks:
1. **Create Queue Configuration**
   - `src/lib/queue.ts` - BullMQ queue instance
   - Configure queue settings (max attempts, backoff, rate limiting)
   - Define job types and interfaces

2. **Create Worker Process**
   - `src/workers/bookingWorker.ts` - Standalone worker process
   - Implement **optimistic locking** logic
   - Handle job failures and retries
   - Process booking jobs asynchronously

3. **Add Queue Monitoring (Arena)**
   - Optional: Add BullMQ Arena for monitoring
   - Visual dashboard for queue status
   - Job management capabilities

4. **Create Shared Types**
   - `src/types/queue.ts` - Job interfaces
   - `src/types/booking.ts` - Extended booking types with status

#### Code Snippet (Optimistic Locking):
```typescript
// Worker processing logic
async processBookingJob(job: Job<BookingJobData>) {
  const { bookingId, eventId, userId } = job.data;

  return await db.begin(async (transaction) => {
    // 1. Get event WITH version (no FOR UPDATE needed!)
    const events = await transaction`
      SELECT id, available_tickets, version 
      FROM events 
      WHERE id = ${eventId}
      -- No FOR UPDATE - we're using optimistic locking!
    `;

    const event = events[0];
    
    // 2. Check availability
    if (event.available_tickets <= 0) {
      await transaction`
        UPDATE bookings 
        SET status = 'FAILED' 
        WHERE id = ${bookingId}
      `;
      return { status: 'FAILED', reason: 'SOLD_OUT' };
    }

    // 3. Update with VERSION CHECK (optimistic locking!)
    const updateResult = await transaction`
      UPDATE events 
      SET available_tickets = available_tickets - 1, 
          version = version + 1
      WHERE id = ${eventId} 
        AND version = ${event.version}  -- Key: check version!
        AND available_tickets > 0
      RETURNING id
    `;

    // 4. Version conflict? Another worker already processed this event
    if (updateResult.length === 0) {
      // Another worker processed this event first
      await transaction`
        UPDATE bookings 
        SET status = 'FAILED' 
        WHERE id = ${bookingId}
      `;
      return { status: 'FAILED', reason: 'VERSION_CONFLICT' };
    }

    // 5. Success - confirm booking
    await transaction`
      UPDATE bookings 
      SET status = 'CONFIRMED' 
      WHERE id = ${bookingId}
    `;

    return { status: 'CONFIRMED' };
  });
}
```

#### Acceptance Criteria:
- [ ] BullMQ queue connects to Redis successfully
- [ ] Worker process starts and listens for jobs
- [ ] Queue accepts booking jobs with correct data structure
- [ ] Worker can be run independently: `node src/workers/bookingWorker.ts`
- [ ] Job processing logic handles concurrency (multiple workers don't conflict)

**Estimated Duration:** 3-4 hours

---

### **Milestone 3: Async Booking API**
*Replace synchronous endpoint with async flow*

#### Tasks:
1. **Update Create Booking Route**
   - Modify `POST /api/v1/bookings` to return **202 Accepted** (not 201)
   - Change response format to include SSE status URL
   - Don't return availableTickets immediately (async)

2. **Update Booking Status Endpoint**
   - `GET /api/v1/bookings/:id` (already exists, but update if needed)
   - Returns current status snapshot (not for polling - SSE is for real-time)
   - Useful for non-real-time status checks or if connecting to SSE after processing

3. **Update Service Layer**
   - Create `bookingService.queue.ts` - Queue booking for async processing
   - Keep `bookingService.transactional.ts` as reference
   - New service: Create pending booking → Queue job → Return job ID

4. **Handle Duplicate Requests**
   - For Level 3, we'll handle duplicates at the database level
   - Database constraints prevent duplicate bookings for same user/event
   - Full idempotency (with idempotency keys) will be Level 4

#### API Response Format:
```typescript
// POST /api/v1/bookings
// Body: { eventId: "uuid" }

// 202 Accepted Response (immediately returned):
{
  "success": true,
  "data": {
    "bookingId": "uuid",
    "status": "PENDING",
    "message": "Booking queued for processing",
    "_links": {
      "event": "/api/v1/events/event-uuid"
    },
    "estimatedProcessingTime": "100-500ms"
  }
}

// SSE endpoint: GET /api/v1/bookings/:id/status
// Client should connect immediately after receiving bookingId:
// const eventSource = new EventSource('/api/v1/bookings/uuid/status')
//
// Server will send real-time events in this format:
{
  "success": true,
  "data": {
    "bookingId": "uuid",
    "eventId": "event-uuid",
    "status": "CONFIRMED", // or "FAILED"
    "createdAt": "2024-01-01T10:00:00Z",
    "updatedAt": "2024-01-01T10:00:10Z"
  }
}
```

**Client Flow:**
1. POST → get bookingId
2. Immediately connect to SSE: `GET /api/v1/bookings/:id/status`
3. Listen for status events (no polling needed)

#### Acceptance Criteria:
- [ ] Booking API returns 202 Accepted in < 100ms
- [ ] Status endpoint shows booking progress
- [ ] PENDING booking is created in database before returning
- [ ] Job is successfully added to queue
- [ ] Worker eventually processes the job (status changes from PENDING)
- [ ] Duplicate requests are handled gracefully (database constraints)

**Estimated Duration:** 3-4 hours

---

### **Milestone 4: Server-Sent Events (SSE) Integration**
*Real-time status updates for clients*

#### Tasks:
1. **Add Server-Sent Events (SSE) Endpoint**
   - `src/lib/sse.ts` - SSE server setup and management
   - Use regular HTTP endpoints (no additional library needed)
   - Authentication for SSE connections
   - Manage client connections by bookingId

2. **Remove Polling Logic** (SSE-only approach)
   - No polling endpoint needed (SSE is simpler and real-time)
   - Client connects to SSE immediately after receiving bookingId
   - No need for wait loops on client side

3. **Emit Server-Sent Events**
   - Worker emits events when booking status changes
   - SSE endpoint pushes real-time updates to connected clients
   - Send status: PENDING, CONFIRMED, or FAILED with relevant data

4. **Client Integration Example**
   - Provide JavaScript client example code
   - Show SSE client implementation

#### Server-Sent Events (SSE) Format:
```typescript
// Client connects to SSE endpoint:
const eventSource = new EventSource('/api/v1/bookings/:id/status', {
  headers: {
    'Authorization': `Bearer ${jwtToken}`
  }
});

// Listen for booking status updates:
eventSource.addEventListener('booking_status', (event) => {
  const data = JSON.parse(event.data);
  console.log(`Booking status: ${data.status}`);
  // Status: PENDING, CONFIRMED, or FAILED
});

// Server sends events:
eventSource.onopen = () => {
  // Connection established
  // Server can push immediate status if booking already processed
}
```

Server sends events in this format:
```
event: booking_status
data: {"bookingId":"uuid","status":"CONFIRMED","message":"Booking confirmed"}

```

#### No Polling Needed:
With SSE, clients don't need to poll. They establish one connection and receive real-time pushes:
- Connection stays open while booking processes
- Event sent immediately when status changes
- Automatic reconnection if connection drops

#### Acceptance Criteria:
- [ ] SSE endpoint is accessible and properly authenticated
- [ ] Clients can connect immediately after receiving bookingId
- [ ] Worker successfully pushes booking status changes in real-time
- [ ] SSE sends status for all state transitions (PENDING→CONFIRMED/FAIL)
- [ ] Client examples demonstrate SSE-only approach (no polling)
- [ ] Average status update latency < 200ms
- [ ] All SSE connections are properly cleaned up after disconnection

**Estimated Duration:** 3-4 hours

---

### **Milestone 5: Integration & Testing**
*Full system integration and validation*

#### Tasks:
1. **Update Docker Compose**
   - Add `worker` service (separate from API)
   - Scale workers: `docker compose up --scale worker=3`
   - Add Redis Insight for monitoring
   - Update environment variables

2. **Update Load Test Script**
   - Borrow logic from Level 2 but test async flow
   - Test both success and retry scenarios
   - Measure end-to-end latency from queue to completion
   - Check for race conditions with optimistic locking

3. **Run Integration Tests**
   - Test with 1 worker (baseline)
   - Test with 3 workers (parallel processing)
   - Test with 5 workers (max concurrency)
   - Verify zero overbookings in all scenarios
   - Monitor version conflict rate (expected ~5-10%)

4. **Performance Benchmarking**
   - Measure queue depth under load
   - Track worker processing speed (jobs/second)
   - Monitor Redis memory usage
   - Compare Level 2 vs Level 3 performance

#### Expected Test Results:
```
======================================================================
📊 LOAD TEST RESULTS - Level 3 (Queue-Based Async)
======================================================================

📈 Request Metrics:
  Total Requests: 10,000
  Acceptances (202): 10,000 (100%) ✅
  HTTP Success Rate: 100%
  Timeouts (503): 0 ✅

⏱️  Performance Metrics:
  API Response Time: ~50ms (vs 800-1500ms in Level 2)
  Queue Processing Time: ~100-300ms per booking
  Worker Throughput: ~50-100 jobs/sec per worker
  Parallel Workers: 3 (150-300 jobs/sec total)

🎟️  Data Integrity:
  Expected Bookings: 100
  Actual Bookings: 100 ✅
  Available Tickets: 0 ✅
  Optimistic Lock Conflicts: ~5-10% (handled gracefully)

✅ Race Condition Analysis:
  🟢 RACE CONDITION: NONE ✅
     - Level 2 locking → Level 3 optimistic locking transition successful
     - Zero overbookings with parallel workers
     - Version conflicts properly handled with retry logic

💡 Level 3 Key Insights:
   ✅ Response time: 95% faster (50ms vs 800-1500ms)
   ✅ Throughput: 5-10x higher (300+ bookings/sec)
   ✅ No database timeouts under load
   ✅ Queue provides natural backpressure
   ✅ Optimistic locking eliminates lock contention
======================================================================
```

#### Acceptance Criteria:
- [ ] All services start with `docker compose up -d`
- [ ] System accepts 10,000 concurrent requests without timeouts
- [ ] Exactly 100 bookings confirmed (data integrity maintained)
- [ ] PENDING → CONFIRMED flow works correctly
- [ ] SSE provides status updates within 200ms
- [ ] Queue depth returns to zero after load test completes
- [ ] Version conflicts are handled gracefully (retry or fail appropriately)
- [ ] Documentation updated with Level 3 instructions

**Estimated Duration:** 4-5 hours

---

### **Milestone 6: Production Hardening**
*Make the system production-ready*

#### Tasks:
1. **Add Health Checks**
   - Redis health endpoint
   - Worker status endpoint (connected, processing rate)
   - Queue depth check (alert if > 1000)
   - Circuit breaker for Redis failures

2. **Graceful Degradation**
   - If Redis is down: **fallback to synchronous processing (Level 2)**
   - If connection to Redis fails: process synchronously
   - Log all fallback events for monitoring
   - Configure via environment variable: `QUEUE_FALLBACK_ENABLED=true`

3. **Logging & Observability**
   - Structured logging (JSON format) with Pino
   - Log queue depth, worker job counts
   - Log optimistic locking conflicts (metrics)
   - Log worker processing times

4. **Rate Limiting**
   - Per-user rate limiting (10 requests/minute)
   - Per-IP rate limiting (100 requests/minute)
   - Queue-based backpressure (stop accepting if queue depth > 1000)

5. **Worker Retry Logic**
   - Configure job retry attempts (3 attempts with exponential backoff)
   - Handle transient failures (database connection, Redis)
   - Move to dead letter queue after max retries

6. **Documentation**
   - Update README.md with Level 3 architecture
   - Add deployment guide (multiple workers)
   - Add monitoring guide (Arena, Redis Insight)
   - Update API documentation with async flow
   - Document optimistic locking behavior

7. **Testing & CI/CD**
   - Unit tests for worker processing
   - Integration tests for optimistic locking
   - Load test in GitHub Actions (optional)
   - Docker build optimization (multi-stage builds)

#### Fallback Logic Example:
```typescript
// If Redis is down, automatically fall back to Level 2
async function createBooking(userId, eventId) {
  try {
    // Try to queue the job
    await queue.add('booking', { userId, eventId });
    return { status: 'PENDING', mode: 'async' };
  } catch (error) {
    if (error.code === 'REDIS_UNAVAILABLE') {
      logger.warn('Redis unavailable, falling back to synchronous processing');
      // Fallback to Level 2 transaction
      const result = await bookingServiceTransactional.createBooking(userId, eventId);
      return { status: 'CONFIRMED', mode: 'sync_fallback' };
    }
    throw error;
  }
}
```

#### Acceptance Criteria:
- [ ] Health checks pass with `curl /health`
- [ ] System gracefully handles Redis downtime (falls back to Level 2)
- [ ] Structured logs produce parseable JSON
- [ ] Rate limiting prevents abuse
- [ ] Failed jobs retry with exponential backoff
- [ ] 80%+ test coverage for new code
- [ ] Documentation is complete and accurate
- [ ] Load test script runs successfully

**Estimated Duration:** 4-5 hours

---

## 📦 Updated Project Structure

```
tickets-hive/
├── migrations/
│   ├── 001_create_users.sql
│   ├── 002_create_events.sql
│   ├── 003_create_bookings.sql
│   ├── 004_add_event_version.sql           [NEW]
├── src/
│   ├── index.ts                      (add SSE endpoint)
│   ├── lib/
│   │   ├── db.ts
│   │   ├── redis.ts                   [NEW]
│   │   ├── queue.ts                   [NEW]
│   │   └── sse.ts                     [NEW]
│   ├── services/
│   │   ├── bookingService.ts          (updated - async flow)
│   │   ├── bookingService.transactional.ts (kept as reference)
│   │   └── eventService.ts
│   ├── routes/
│   │   ├── bookings.ts                (updated - 202 Accepted)
│   │   ├── events.ts
│   │   └── health.ts                  (updated - Redis health)
│   ├── workers/
│   │   └── bookingWorker.ts           [NEW]
│   └── types/
│       ├── index.ts
│       └── queue.ts                   [NEW]
├── docker-compose.yml                (add Redis + worker)
├── package.json                      (add BullMQ dependencies)
└── README.md                         (update with Level 3)
```

---

## 🛠️ Implementation Checklist

### Phase 1: Foundation (Milestone 1)
- [ ] Add Redis to Docker Compose
- [ ] Install BullMQ dependencies
- [ ] Create Redis connection utility
- [ ] Update database schema (version, status columns)
- [ ] Run migrations successfully

### Phase 2: Queue Core (Milestone 2)
- [ ] Create BullMQ queue configuration
- [ ] Implement worker process with optimistic locking
- [ ] Test worker standalone
- [ ] Verify job processing works correctly

### Phase 3: Async API (Milestone 3)
- [ ] Update booking route to return 202 Accepted
- [ ] Create pending booking in database
- [ ] Queue job with correct data
- [ ] Status endpoint shows PENDING → processing
- [ ] Handle duplicates at database level

### Phase 4: Real-time Updates (Milestone 4)
- [ ] Add SSE endpoint
- [ ] Worker emits status updates
- [ ] Clients receive real-time notifications via SSE
- [ ] Status update latency < 200ms

### Phase 5: Integration Testing (Milestone 5)
- [ ] All services start successfully
- [ ] Load test with 1000+ concurrent requests
- [ ] Zero overbookings verified
- [ ] Queue depth stays manageable (< 1000)
- [ ] Version conflicts handled gracefully

### Phase 6: Production Ready (Milestone 6)
- [ ] Health checks pass
- [ ] Graceful degradation to Level 2 works
- [ ] Structured logging implemented
- [ ] Rate limiting configured
- [ ] Retry logic for failed jobs
- [ ] 80%+ test coverage
- [ ] Documentation complete

---

## 📊 Expected Outcomes

### Performance Comparison

| Metric | Level 2 (Current) | Level 3 (Target) | Improvement |
|--------|-------------------|------------------|-------------|
| **Concurrent Requests** | 1,000 | 10,000+ | 10x |
| **Response Time (P95)** | 1500ms | 100ms | 93% faster |
| **Timeout Rate** | 1-2% | 0% | Eliminated |
| **Throughput** | 200-333 req/s | 1,000+ req/s | 3-5x |
| **Data Integrity** | 100% (FOR UPDATE) | 100% (optimistic) | Maintained |
| **Scalability** | DB bottleneck | Horizontal (workers) | Infinite |

### Key Changes: Level 2 → Level 3

| Aspect | Level 2 | Level 3 |
|--------|---------|---------|
| **Locking Strategy** | Pessimistic (`FOR UPDATE`) | Optimistic (`version` column) |
| **Response Pattern** | Synchronous (201 Created) | Async (202 Accepted + SSE) |
| **Architecture** | Direct DB calls | Queue + Worker |
| **Throughput** | Limited by DB locks | Limited by worker count |
| **Latency** | High (lock contention) | Low (immediate response) |

---

## 🎯 Success Criteria

Level 3 is complete when:

1. ✅ **API returns 202 Accepted** in under 100ms for all requests
2. ✅ **Zero timeout errors** under 10,000 concurrent requests
3. ✅ **100% data integrity** maintained (exactly 100 bookings for 100 tickets)
4. ✅ **Optimistic locking** prevents overbookings with parallel workers
5. ✅ **Status updates** delivered via Server-Sent Events within 200ms
6. ✅ **Queue processes** all jobs reliably (no lost bookings)
7. ✅ **Graceful degradation** works if Redis fails (fallback to Level 2)
8. ✅ **Documentation** updated with Level 3 architecture and usage

---

## 🚀 Next Steps

1. **Review this plan** - Let me know if any milestones need adjustment
2. **Start Milestone 1** - Begin with Redis and schema updates
3. **Implement iteratively** - Test each milestone before proceeding
4. **Run load tests** - Verify at each stage with 1000+ requests
5. **Compare Level 2 vs 3** - Document performance improvements

**Ready to start?** I recommend beginning with **Milestone 1: Infrastructure Setup**.

Let me know how you'd like to proceed! 🚀