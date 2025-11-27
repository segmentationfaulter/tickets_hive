# TicketHive Level 3 Production Hardening Plan

**Level 3 MVP → Production-Ready**

## 🎯 Goal: Make Async Booking Production-Ready

**Current State (MVP):**
- ✅ Async booking works (<100ms response)
- ✅ Optimistic locking prevents overbookings
- ✅ SSE delivers status updates reliably
- ❌ No protection against abuse
- ❌ No graceful failure when Redis is down
- ❌ No queue backpressure
- ❌ No monitoring dashboard
- ❌ No structured logging or metrics

**Production Target State:**
- 🛡️ Rate limiting (10 req/min per user)
- 🛡️ Circuit breaker (fail fast on Redis failure)
- 🛡️ Queue backpressure (prevent Redis overload)
- 📊 Separate dashboard for monitoring
- 📊 Structured logging and metrics
- ⚡ Configuration via environment variables
- 🔒 Security hardening

**What You're Adding:** Protection, monitoring, and tuning - the invisible features that prevent 3am pages.

---

## 📋 Production Architecture (Additions to MVP)

```
┌─────────────────────────────────────────────────┐
│         MVP Foundation (Already Built)          │
│  Client → API → Redis → Worker → DB → SSE       │
└──────────────────┬──────────────────────────────┘
                   │
                   │ Production Additions:
                   │
                   │ 🛡️ Rate Limiter
                   │    Checks: User limit (10/min)
                   │             Queue depth limit
                   │
                   │ 🛡️ Circuit Breaker
                   │    Monitors: Redis health
                   │    Action: Fast fail (503)
                   │
                   │ 📊 Dashboard Service
                   │    Port: 3001 (opt-in)
                   │    Auth: Admin role required
                   │
                   │ 📊 Metrics Collection
                   │    Queue depth, processing time
                   │    Conflict rate, retry count
                   │
                   │ ⚡ Configurable Everything
                   │    Via environment variables
                   │
┌──────────────────▼──────────────────────────────┐
│           Production Monitoring Stack           │
│  • Alerts on high queue depth (>500)            │
│  • Alerts on high conflict rate (>10%)          │
│  • Alerts on circuit breaker open               │
│  • Structured logs for debugging                │
└─────────────────────────────────────────────────┘
```

**What's Different from MVP:**
- API checks rate limits before queueing
- Circuit breaker prevents database overload
- Queue depth monitoring prevents Redis memory issues
- Dashboard shows real-time queue status
- Everything configurable without code changes

---

## 🛣️ Production Hardening Roadmap: 4 Milestones

### **Milestone 7: Rate Limiting & Queue Protection**

**Objective:** Prevent abuse and Redis overload.

** Tasks:**
1. **Create Rate Limiting Middleware** (`apps/api/src/middleware/rate-limit.ts`):
```typescript
const rateLimiter = {
  // Per-user rate limiting
  perUser: new Map<string, { count: number; timestamp: number }>(),
  
  checkUserLimit(userId: string) {
    const now = Date.now();
    const user = this.perUser.get(userId);
    
    if (!user || now - user.timestamp > 60000) {
      this.perUser.set(userId, { count: 1, timestamp: now });
      return { allow: true };
    }
    
    if (user.count >= 10) { // 10 req/min
      return { 
        allow: false, 
        retryAfter: 60 - Math.floor((now - user.timestamp) / 1000) 
      };
    }
    
    user.count++;
    return { allow: true };
  },
  
  // Queue backpressure
  async checkQueuePressure() {
    const waiting = await bookingQueue.getWaitingCount();
    if (waiting > env.REDIS_QUEUE_MAX_DEPTH) {
      return { allow: false, retryAfter: 30 };
    }
    return { allow: true };
  }
};
```

2. **Add Rate Limit to Booking Endpoint**:
```typescript
// In POST /api/v1/bookings router
const rateLimit = rateLimiter.checkUserLimit(req.user!.userId);
if (!rateLimit.allow) {
  return res.status(429).json({
    error: {
      code: "RATE_LIMIT_EXCEEDED",
      message: `Too many requests. Retry after ${rateLimit.retryAfter}s.`
    }
  });
}

const queuePressure = await rateLimiter.checkQueuePressure();
if (!queuePressure.allow) {
  return res.status(503).json({
    error: {
      code: "QUEUE_OVERLOAD",
      message: "High traffic detected. Please try again in a moment."
    }
  });
}
```

3. **Add Configuration to Environment**:
```typescript
// packages/lib/src/env.ts
REDIS_QUEUE_MAX_DEPTH: z.number().default(1000),
RATE_LIMIT_PER_USER: z.number().default(10),
RATE_LIMIT_WINDOW_MS: z.number().default(60000),
```

**Validation:**
```bash
# Test rate limit
curl -X POST http://localhost:3000/api/v1/bookings \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"eventId": "..."}'
# Repeat 11 times
# 11th request: 429 Too Many Requests ✅

# Test queue backpressure (under load)
npm run test:load
# Should see: Very few 503 responses during peak
```

**Time Estimate:** 2-3 hours
**Difficulty:** Medium (new concepts)

**Key Learning:** Rate limiting is like request throttling - prevents one user from overwhelming the system.

---

### **Milestone 8: Circuit Breaker - Graceful Redis Failure**

**Objective:** When Redis fails, fail fast (503) instead of hanging.

** Tasks:**
1. **Install Circuit Breaker Library**:
```bash
npm install opossis # BullMQ uses this internally
```

2. **Create Circuit Breaker** (`packages/lib/src/redis.ts`):
```typescript
import CircuitBreaker from 'opossum';

const redisCircuitBreaker = new CircuitBreaker(
  async (operation: () => Promise<any>) => operation(),
  {
    timeout: 3000, // 3s timeout
    errorThresholdPercentage: 50, // Open after 50% errors
    resetTimeout: 30000, // Try again after 30s
    rollingCountTimeout: 10000,
    rollingCountBuckets: 10,
  }
);

redisCircuitBreaker.on('open', () => {
  console.error('🔴 Circuit breaker OPEN - Redis is down');
});

redisCircuitBreaker.on('halfOpen', () => {
  console.warn('🟡 Circuit breaker HALF-OPEN - Testing Redis');
});

redisCircuitBreaker.on('close', () => {
  console.log('🟢 Circuit breaker CLOSED - Redis recovered');
});

export async function callWithCircuitBreaker<T>(
  operation: () => Promise<T>
): Promise<T> {
  return redisCircuitBreaker.fire(operation);
}
```

3. **Wrap Queue Operations**:
```typescript
// In queueService.ts
export async function createBookingJob(data: BookingJobData) {
  if (redisCircuitBreaker.opened) {
    throw new AppError(
      ErrorCode.REDIS_UNAVAILABLE,
      'Queue temporarily unavailable'
    );
  }
  
  return await callWithCircuitBreaker(async () => {
    const job = await bookingQueue.add('booking', data);
    return job.id;
  });
}
```

4. **Add to Error Codes**:
```typescript
// packages/lib/src/errors.ts
REDIS_UNAVAILABLE: {
  statusCode: 503,
  message: 'Service temporarily unavailable. Please retry.'
}
```

**Validation:**
```bash
# Test Redis failure
docker compose stop redis

curl -X POST http://localhost:3000/api/v1/bookings \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"eventId": "..."}'
# Expected: 503 Service Unavailable (immediately)
# NOT: Hang indefinitely

docker compose start redis
# After 30s: Circuit breaker closes, requests work again
```

**Time Estimate:** 2-3 hours
**Difficulty:** Medium (new pattern)

**Key Learning:** Circuit breaker is like a kill switch - when Redis dies, immediately stop accepting requests instead of hanging.

---

### **Milestone 9: Integration Testing & Performance Tuning**

**Objective:** Validate system behavior under realistic load and tune configuration.

** Tasks:**
1. **Update Load Test** (`tests/load-test.ts`):
   - Test full flow: POST → SSE → Completion
   - Measure API response time (target: <100ms p95)
   - Measure worker processing time (target: 200-500ms)
   - Measure total booking time (target: <2s end-to-end)
   - Count rate limit hits (should be minimal)
   - Monitor circuit breaker state

2. **Run 10K Request Test**:
```bash
npm run test:load -- --requests=10000
```

3. **Expected Results**:
```
📊 LOAD TEST RESULTS - Level 3 Production

Total Requests: 10000
API Response Time: 45ms avg, 95ms p95 ✅
Worker Processing: 350ms avg ✅
Time to Complete: 1.2s avg ✅

Bookings Created: 100 ✅
Rate Limited: 5 (0.05%) ✅
503 Errors: 0 ✅
Timeouts: 0 ✅

Version Conflicts: 12 retries (12% of successful) ⚠️
→ Action: Consider increasing WORKER_MAX_RETRIES to 5
```

4. **Configuration Tuning**:
   - If conflict rate > 10%: Increase `WORKER_MAX_RETRIES`
   - If queue depth > 500: Increase `WORKER_CONCURRENCY`
   - If API response > 100ms: Check rate limiter performance
   - If worker processing > 1s: Check database indexes

5. **Document Performance Results** (`docs/level3-performance.md`):
   - Level 2 vs Level 3 comparison
   - Configuration used
   - Bottlenecks identified
   - Tuning recommendations

**Validation:**
```bash
# Check metrics
docker compose exec redis redis-cli INFO | grep -A 5 "keyspace"
# Should show reasonable memory usage

# Monitor version conflicts
# Look for "EVENT_SOLD_OUT_OR_CONFLICT" in worker logs
docker compose logs worker | grep "CONFLICT" | wc -l
# Should be < 5% of successful bookings
```

**Time Estimate:** 3-4 hours
**Difficulty:** Hard (requires analysis and tuning)

**Key Learning:** Production systems need tuning based on metrics, not assumptions.

---

### **Milestone 10: Separate Dashboard & Observability**

**Objective:** Create monitoring UI and structured logging.

** Tasks:**
1. **Create Dashboard Service** (`apps/dashboard/src/index.ts`):
```typescript
// Mount BullMQ dashboard at root
import { ExpressAdapter } from '@bull-board/express';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';

const serverAdapter = new ExpressAdapter();
serverAdapter.setBasePath('/');

createBullBoard({
  queues: [new BullMQAdapter(bookingQueue)],
  serverAdapter,
});

app.use('/', serverAdapter.getRouter());
```

2. **Docker Service Setup** (`compose.yaml`):
```yaml
dashboard:
  build:
    context: .
    target: development
  ports:
    - "3001:3001"
  depends_on:
    - redis
  profiles:
    - monitoring  # Only starts with --profile monitoring
```

3. **Add Authentication**:
```typescript
app.use(verifyJWT, requireAdmin);
```

4. **Add Structured Logging** (optional but recommended):
```bash
npm install pino pino-pretty
```

```typescript
import pino from 'pino';

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: {
    target: 'pino-pretty',
    options: { colorize: true }
  }
});

// Usage
logger.info({ jobId, userId }, 'Booking job created');
logger.warn({ jobId, attempts }, 'Version conflict, retrying');
logger.error({ jobId, error }, 'Booking job failed');
```

5. **Add Metrics Collection**:
```typescript
// Track queue depth gauge
setInterval(async () => {
  const waiting = await bookingQueue.getWaitingCount();
  const active = await bookingQueue.getActiveCount();
  metrics.gauge('queue.depth', waiting + active);
}, 5000);

// Track processing time histogram
const start = Date.now();
await processBooking(job);
metrics.histogram('worker.processing_time', Date.now() - start);

// Track conflict counter
metrics.counter('booking.version_conflict', 1);
```

**Validation:**
```bash
# Start dashboard explicitly
docker compose --profile monitoring up -d dashboard

# Access dashboard
curl http://localhost:3001
# Should show BullMQ queue status

# Verify API doesn't mount dashboard
curl http://localhost:3000/admin/queues
# Should return 404

# Stop monitoring
docker compose --profile monitoring down
```

**Production Recommendation**:
```yaml
# In production, disable dashboard or restrict to internal network
services:
  dashboard:
    profiles:
      - never  # Never start in production
```

**Time Estimate:** 3-4 hours
**Difficulty:** Medium (mostly configuration)

**Key Learning:** Dashboard is for debugging, not a production requirement. External monitoring (DataDog, New Relic) is usually better.

---

## ✅ Production Success Criteria

After completing all 4 milestones:

```bash
npm run test:load
```

**Expected Output:**
```
📊 LOAD TEST RESULTS - Level 3 Production

📈 Performance Metrics:
  Total Requests: 10000
  API Response: 45ms avg, 95ms p95 ⚡
  Worker Processing: 350ms avg
  Timeouts: 0 ✅
  Rate Limited: 12 (< 1%) ✅
  503 Errors: 0 ✅

🎟️  Data Integrity:
  Bookings Created: 100 ✅
  No Overbookings: Confirmed ✅
  Final Version: 100 ✅

🛡️  Protection:
  Rate Limiter: Active ✅
  Circuit Breaker: Closed ✅
  Queue Backpressure: Functional ✅

📡 Observability:
  Dashboard: Available at :3001 ✅
  Structured Logs: Enabled ✅
  Metrics: Collected ✅ (conflict rate: 3%)

✅ PRODUCTION READY: Ready for flash sale traffic!
```

---

## 📊 Before vs After Production Hardening

| Aspect | MVP | Production | Impact |
|--------|-----|------------|--------|
| **API Abuse Protection** | None | Rate limit 10/min | Prevents one user from taking all tickets |
| **Redis Failure** | Hangs | 503 immediately | Database protected from overload |
| **Queue Memory** | No limit | Max 1000 jobs | Prevents Redis OOM |
| **Monitoring** | Redis CLI | Dashboard + metrics | Real-time visibility |
| **Configuration** | Hardcoded | Environment vars | No code changes for tuning |
| **Logging** | console.log | Structured logs | Debugging in production |

---

## 🔧 Production Configuration Guide

**Key Environment Variables:**

```bash
# Rate Limiting
RATE_LIMIT_PER_USER=10          # requests per minute
RATE_LIMIT_WINDOW_MS=60000      # 60 seconds
REDIS_QUEUE_MAX_DEPTH=1000      # max waiting jobs

# Retry Strategy
WORKER_MAX_RETRIES=3            # give up after N tries
WORKER_RETRY_DELAY_MS=100       # initial delay
WORKER_RETRY_MAX_DELAY_MS=1000  # max delay (with jitter)
WORKER_CONCURRENCY=5            # concurrent jobs per worker

# Circuit Breaker
CIRCUIT_BREAKER_TIMEOUT=3000          # 3s timeout
CIRCUIT_BREAKER_ERROR_THRESHOLD=50   # 50% errors to open
CIRCUIT_BREAKER_RESET_TIMEOUT=30000  # 30s reset

# Redis
REDIS_HOST=redis
REDIS_PORT=6379
# Redis password in production (optional in dev)
```

**Recommended Values by Traffic:**

| Traffic Level | Concurrent Users | Recommended Config |
|--------------|------------------|-------------------|
| Development | 1-10 | Default (above) |
| Staging | 100 | `WORKER_CONCURRENCY=3` |
| Low Traffic | 1K | `WORKER_CONCURRENCY=5`, `RATE_LIMIT_PER_USER=20` |
| Flash Sale | 10K | `WORKER_CONCURRENCY=10`, `REDIS_QUEUE_MAX_DEPTH=2000` |

**How to Tune:**
1. Run load test
2. Identify bottleneck:
   - API slow → Check rate limiter performance
   - Worker slow → Increase `WORKER_CONCURRENCY`
   - High conflicts → Increase `WORKER_MAX_RETRIES`
   - Queue growing → Add more workers
   - 503 errors → Increase `REDIS_QUEUE_MAX_DEPTH`
3. Adjust environment variable
4. Restart services
5. Re-run test

---

## 📞 Production Operations Guide

### **Common Scenarios**

**Scenario 1: High Queue Depth**
```bash
# Check current depth
docker compose exec redis redis-cli LLEN "bull:booking:waiting"

# If > 1000 consistently:
# 1. Scale workers
docker compose up -d --scale worker=5

# 2. Check for stuck jobs
docker compose logs worker | grep "ERROR"

# 3. If still high, reduce rate limit
echo "RATE_LIMIT_PER_USER=5" >> .env.docker
```

**Scenario 2: Circuit Breaker Open**
```bash
# Check logs
docker compose logs api | grep "Circuit breaker OPEN"

# 1. Check Redis health
docker compose exec redis redis-cli ping

# 2. Investigate Redis logs
docker compose logs redis

# 3. Once Redis recovers, wait 30s for circuit to close
# 4. Monitor: docker compose logs api | grep "Circuit breaker CLOSED"
```

**Scenario 3: High Version Conflict Rate**
```bash
# Count conflicts
docker compose logs worker | grep "EVENT_SOLD_OUT_OR_CONFLICT" | wc -l

# If > 10% of successful bookings:
# 1. Increase retries
echo "WORKER_MAX_RETRIES=5" >> .env.docker

# 2. Or increase concurrency
echo "WORKER_CONCURRENCY=8" >> .env.docker

# 3. Restart workers
docker compose restart worker
```

**Scenario 4: Deploying Without Downtime**
```bash
# 1. Start new workers
docker compose up -d --scale worker=5 --no-deps worker

# 2. Wait for them to be ready
docker compose logs worker | grep "listening"

# 3. Stop old workers
docker compose stop worker

# 4. Scale down
docker compose up -d --scale worker=3
```

---

## 🎯 Production Checklist

**Before Going Live:**
- [ ] Rate limiting tested (confirmed 429 responses)
- [ ] Circuit breaker tested (confirmed 503 on Redis down)
- [ ] 10K load test passed (<100ms API response)
- [ ] Queue depth stays < 500 under load
- [ ] Version conflict rate < 5%
- [ ] Dashboard accessible (if using)
- [ ] Structured logging configured
- [ ] Metrics collection working
- [ ] Environment variables configured for production traffic
- [ ] Alerts set up (queue depth, circuit breaker, conflict rate)
- [ ] Runbook documented (this guide)
- [ ] Team trained on operations

**Security:**
- [ ] Dashboard not exposed publicly (or VPN-protected)
- [ ] Redis password set in production
- [ ] Rate limits appropriate for traffic
- [ ] Circuit breaker prevents database overload

---

## 📞 Getting Help in Production

**Metrics to Collect When Debugging:**
```bash
# Queue state
docker compose exec redis redis-cli KEYS "bull:*" | wc -l
docker compose exec redis redis-cli LLEN "bull:booking:waiting"
docker compose exec redis redis-cli LLEN "bull:booking:active"

# Worker status
docker compose logs worker --tail=100

# API performance
docker compose logs api --tail=100 | grep "202 Accepted"

# Circuit breaker state
docker compose logs api | grep "Circuit breaker"

# Rate limit hits
docker compose logs api | grep "429" | wc -l
```

**When to Escalate:**
- Queue depth > 5000 (system overload)
- Circuit breaker stays open > 5 minutes (Redis issue)
- Version conflict rate > 20% (tuning needed)
- 503 errors > 1% of requests (capacity issue)

**Team Communication:**
- Document changes to environment variables
- Share dashboard access (if using)
- Train team on circuit breaker behavior
- Set up PagerDuty/Opsgenie alerts

---

**Plan Version:** 3.1 (Production Hardening)
**Target:** MVP → Production-Ready
**Goal:** Handle 10K+ concurrent users safely
