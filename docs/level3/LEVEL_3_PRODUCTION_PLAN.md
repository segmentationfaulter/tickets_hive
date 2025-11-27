# TicketHive Level 3 Production Hardening Plan

## 🎯 Goal: Production-Ready Resilience & Monitoring

**This is Part 2 of Level 3 - Production Hardening**

**Prerequisites**: Complete MVP (Milestones 0-6) first. Your async booking system should be working end-to-end.

**What You'll Add**: Real-time status updates, edge case handling, rate limiting, circuit breakers, and monitoring. After this phase, your system will be production-ready.

---

## 📋 What's Added in Production Phase

```
MVP System (M0-M6):
  ✅ API returns 202 + jobId
  ✅ Workers process jobs with optimistic locking
  ✅ Basic status polling via GET /status/:jobId

Production Additions (M7-M10):
  ✨ Real-time SSE updates (no polling needed)
  ✨ "Fast Worker" edge case handled
  ✨ Rate limiting (10 req/min per user)
  ✨ Circuit breaker (hard fail when Redis down)
  ✨ Comprehensive error handling
  ✨ BullMQ monitoring dashboard
  ✨ 10K concurrent request load testing
```

---

## 🛣️ Production Milestones (7-10)

### **Milestone 7: Server-Sent Events (SSE) Implementation**

**Objective**: Provide real-time status updates to clients via Server-Sent Events, using BullMQ QueueEvents for reliable horizontal scaling.

**Why SSE?**: Instead of clients polling every second, the server pushes updates as they happen. HTTP-based, auto-reconnection, simpler than WebSockets.

**Why QueueEvents?**: Raw Redis Pub/Sub doesn't scale horizontally. QueueEvents broadcasts to all API instances, allowing any instance to notify its connected clients.

**Tasks**:

1. **SSE Endpoint Setup**

   Update `apps/api/src/routes/bookings.ts`:
   ```typescript
   import { QueueEvents } from "bullmq";
   import { redis } from "@ticket-hive/lib";

   /**
    * GET /api/v1/bookings/status/:jobId
    *
    * Production: Real-time SSE updates (replaces polling)
    */
   router.get("/status/:jobId", async (req, res) => {
     const { jobId } = req.params;

     // Set SSE headers
     res.writeHead(200, {
       "Content-Type": "text/event-stream",
       "Cache-Control": "no-cache",
       "Connection": "keep-alive",
       "X-Accel-Buffering": "no", // Disable nginx buffering
     });

     // Send initial status
     res.write(`event: connected\ndata: {"jobId": "${jobId}"}\n\n`);

     // Subscribe to job events
     const queueEvents = new QueueEvents("booking", { connection: redis });

     const onCompleted = ({ jobId: completedId, returnvalue }: any) => {
       if (completedId === jobId) {
         res.write(
           `event: confirmed\ndata: ${JSON.stringify(returnvalue)}\n\n`
         );
         res.end();
         cleanup();
       }
     };

     const onFailed = ({ jobId: failedId, failedReason }: any) => {
       if (failedId === jobId) {
         res.write(
           `event: failed\ndata: ${JSON.stringify({ error: failedReason })}\n\n`
         );
         res.end();
         cleanup();
       }
     };

     const onProgress = ({ jobId: progressId, data }: any) => {
       if (progressId === jobId) {
         res.write(`event: progress\ndata: ${JSON.stringify(data)}\n\n`);
       }
     };

     queueEvents.on("completed", onCompleted);
     queueEvents.on("failed", onFailed);
     queueEvents.on("progress", onProgress);

     // Cleanup on client disconnect
     const cleanup = () => {
       queueEvents.off("completed", onCompleted);
       queueEvents.off("failed", onFailed);
       queueEvents.off("progress", onProgress);
       queueEvents.close();
     };

     req.on("close", cleanup);
   });
   ```

2. **Track Active Connections**

   Create `apps/api/src/lib/connectionManager.ts`:
   ```typescript
   import { Response } from "express";

   /**
    * Connection Manager
    *
    * Tracks active SSE connections per API instance.
    * Each instance only tracks its own connections (no shared state).
    */
   class ConnectionManager {
     private connections = new Map<string, Response>();

     add(jobId: string, res: Response) {
       this.connections.set(jobId, res);
     }

     remove(jobId: string) {
       this.connections.delete(jobId);
     }

     get(jobId: string): Response | undefined {
       return this.connections.get(jobId);
     }

     getCount(): number {
       return this.connections.size;
     }
   }

   export const connectionManager = new ConnectionManager();
   ```

3. **Client Example**

   Create `examples/sse-client.html`:
   ```html
   <!DOCTYPE html>
   <html>
     <head>
       <title>Async Booking with SSE</title>
     </head>
     <body>
       <h1>Real-Time Booking Status</h1>
       <div id="status">Connecting...</div>

       <script>
         async function bookTicket() {
           const authToken = "YOUR_TOKEN";
           const eventId = "YOUR_EVENT_ID";

           // 1. Create booking
           const response = await fetch(
             "http://localhost:3000/api/v1/bookings",
             {
               method: "POST",
               headers: {
                 "Content-Type": "application/json",
                 Authorization: `Bearer ${authToken}`,
               },
               body: JSON.stringify({ eventId }),
             }
           );

           const result = await response.json();
           const { jobId } = result.data;

           console.log("Job created:", jobId);

           // 2. Connect to SSE for real-time updates
           const eventSource = new EventSource(
             `http://localhost:3000/api/v1/bookings/status/${jobId}`
           );

           eventSource.addEventListener("connected", (e) => {
             document.getElementById("status").textContent =
               "Connected. Waiting for result...";
           });

           eventSource.addEventListener("confirmed", (e) => {
             const data = JSON.parse(e.data);
             document.getElementById("status").textContent =
               `✅ Booking confirmed! ID: ${data.bookingId}`;
             eventSource.close();
           });

           eventSource.addEventListener("failed", (e) => {
             const data = JSON.parse(e.data);
             document.getElementById("status").textContent =
               `❌ Booking failed: ${data.error}`;
             eventSource.close();
           });

           eventSource.addEventListener("progress", (e) => {
             const data = JSON.parse(e.data);
             document.getElementById("status").textContent =
               `Processing: ${data.message}`;
           });

           eventSource.onerror = (error) => {
             console.error("SSE error:", error);
             eventSource.close();
           };
         }

         // Auto-run on page load
         bookTicket();
       </script>
     </body>
   </html>
   ```

**Expected Output**:
- ✅ Client can connect to SSE endpoint
- ✅ Real-time status updates delivered (no polling)
- ✅ Automatic reconnection on disconnect (EventSource built-in)
- ✅ Multiple clients can listen to same job
- ✅ Works with multiple API instances (QueueEvents broadcasts to all)

**Validation**:
```bash
# Test SSE with curl
curl -N http://localhost:3000/api/v1/bookings/status/YOUR_JOB_ID

# Should stream events:
# event: connected
# data: {"jobId": "..."}
#
# event: confirmed
# data: {"success": true, "bookingId": "..."}

# Test with multiple API instances
docker compose up -d --scale server=3

# Create booking, connect SSE
# Should work regardless of which API instance serves SSE
```

**Files Modified/Created**:
- `apps/api/src/routes/bookings.ts` (add SSE endpoint)
- `apps/api/src/lib/connectionManager.ts` (NEW - track connections)
- `examples/sse-client.html` (NEW - browser example)

---

### **Milestone 8: Robust SSE - "Fast Worker" Race Condition Fix**

**Objective**: Handle the race condition where worker finishes before client connects to SSE, ensuring clients always receive final status.

**The Problem**:
```
Timeline:
  0ms:  Client POST /book → API creates job → API returns 202
 10ms:  Worker picks up job → Processes in 10ms → Publishes "completed"
 50ms:  Client receives 202 → Starts SSE connection
 60ms:  Client subscribes to events
  BUG: The "completed" event was at 10ms, subscription at 60ms
       → Client waits forever
```

**The Solution**: Check job state BEFORE subscribing. If already completed, send result immediately.

**Tasks**:

1. **Check State Before Subscribing**

   Update `apps/api/src/routes/bookings.ts`:
   ```typescript
   import { bookingQueue } from "@ticket-hive/lib";

   router.get("/status/:jobId", async (req, res) => {
     const { jobId } = req.params;

     // Set SSE headers
     res.writeHead(200, {
       "Content-Type": "text/event-stream",
       "Cache-Control": "no-cache",
       "Connection": "keep-alive",
       "X-Accel-Buffering": "no",
     });

     // 1. Check current job state IMMEDIATELY
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
       res.write(
         `event: failed\ndata: ${JSON.stringify({ error: job.failedReason })}\n\n`
       );
       return res.end();
     }

     // 4. Only subscribe if job is still active
     const state = await job.getState();
     res.write(
       `event: ${state}\ndata: ${JSON.stringify({ status: state })}\n\n`
     );

     // Now subscribe to QueueEvents for updates
     const queueEvents = new QueueEvents("booking", { connection: redis });

     const onCompleted = ({ jobId: completedId, returnvalue }: any) => {
       if (completedId === jobId) {
         res.write(
           `event: confirmed\ndata: ${JSON.stringify(returnvalue)}\n\n`
         );
         res.end();
         cleanup();
       }
     };

     const onFailed = ({ jobId: failedId, failedReason }: any) => {
       if (failedId === jobId) {
         res.write(
           `event: failed\ndata: ${JSON.stringify({ error: failedReason })}\n\n`
         );
         res.end();
         cleanup();
       }
     };

     queueEvents.on("completed", onCompleted);
     queueEvents.on("failed", onFailed);

     const cleanup = () => {
       queueEvents.off("completed", onCompleted);
       queueEvents.off("failed", onFailed);
       queueEvents.close();
     };

     req.on("close", cleanup);
   });
   ```

2. **Test the Race Condition**

   Create `tests/test-fast-worker.ts`:
   ```typescript
   import { bookingQueue } from "@ticket-hive/lib";
   import { BookingJobData } from "@ticket-hive/types";

   /**
    * Test: Worker finishes before client connects
    *
    * Expected: Client still receives result immediately
    */
   async function testFastWorker() {
     const jobData: BookingJobData = {
       userId: "test-user",
       eventId: "test-event",
       timestamp: Date.now(),
     };

     // Create job
     const job = await bookingQueue.add("process-booking", jobData);
     console.log("Job created:", job.id);

     // Wait for worker to complete (assume fast worker)
     await new Promise((resolve) => setTimeout(resolve, 2000));

     // Now "client" connects to SSE (late)
     console.log("Connecting to SSE (late)...");

     const response = await fetch(
       `http://localhost:3000/api/v1/bookings/status/${job.id}`
     );

     // Should immediately receive completed event
     const reader = response.body?.getReader();
     const decoder = new TextDecoder();

     if (reader) {
       const { value } = await reader.read();
       const text = decoder.decode(value);
       console.log("Received:", text);

       if (text.includes("event: confirmed")) {
         console.log("✅ Test passed: Received completed event immediately");
       } else {
         console.log("❌ Test failed: Did not receive completed event");
       }
     }

     process.exit(0);
   }

   testFastWorker();
   ```

**Expected Output**:
- ✅ Client receives status even if worker finished before connection
- ✅ No hanging connections waiting for missed events
- ✅ Works reliably from 10ms to 10s processing times
- ✅ Handles network delays, slow clients, and retries

**Validation**:
```bash
# Manual test
# 1. Create booking → get jobId
# 2. Wait 2 seconds (let worker complete)
# 3. Connect to SSE endpoint
# Expected: Immediate "confirmed" event (no waiting)

# Automated test
node --experimental-transform-types tests/test-fast-worker.ts
# Should output: "✅ Test passed"
```

**Files Modified/Created**:
- `apps/api/src/routes/bookings.ts` (add state check)
- `tests/test-fast-worker.ts` (NEW - race condition test)

---

### **Milestone 9: Production Features - Rate Limiting, Circuit Breakers, & Load Testing**

**Objective**: Add production-grade resilience patterns and validate system under extreme load.

**Tasks**:

1. **Rate Limiting Middleware**

   Install dependencies:
   ```bash
   npm install express-rate-limit
   ```

   Create `apps/api/src/middleware/rate-limit.ts`:
   ```typescript
   import rateLimit from "express-rate-limit";
   import { redis } from "@ticket-hive/lib";

   /**
    * Rate Limiter: 10 requests per minute per user
    *
    * Prevents queue overflow and abuse.
    */
   export const bookingRateLimiter = rateLimit({
     windowMs: 60 * 1000, // 1 minute
     max: 10, // 10 requests per window
     message: {
       success: false,
       error: {
         code: "RATE_LIMIT_EXCEEDED",
         message:
           "Too many booking requests. Please try again in a moment.",
       },
     },
     standardHeaders: true,
     legacyHeaders: false,
     // Use Redis for distributed rate limiting (multi-instance support)
     store: new RedisStore({
       client: redis,
       prefix: "rl:booking:",
     }),
     // Rate limit by user ID (if authenticated)
     keyGenerator: (req) => {
       return req.user?.id || req.ip;
     },
   });
   ```

   Apply to booking endpoint:
   ```typescript
   // apps/api/src/routes/bookings.ts
   import { bookingRateLimiter } from "../middleware/rate-limit.js";

   router.post("/", verifyToken, bookingRateLimiter, async (req, res) => {
     // ... booking logic
   });
   ```

2. **Circuit Breaker for Redis**

   Install dependencies:
   ```bash
   npm install opossum
   ```

   Update `packages/lib/src/redis.ts`:
   ```typescript
   import CircuitBreaker from "opossum";
   import { env } from "./env.js";

   /**
    * Circuit Breaker Configuration
    *
    * Protects against cascading failures when Redis is down.
    * Opens after 50% error rate, returns 503 immediately.
    */
   const circuitBreakerOptions = {
     timeout: 3000, // 3 second timeout
     errorThresholdPercentage: 50, // Open after 50% errors
     resetTimeout: 30000, // Try again after 30 seconds
     rollingCountTimeout: 10000, // 10 second window
     rollingCountBuckets: 10,
   };

   export const redisCircuitBreaker = new CircuitBreaker(
     async (operation: () => Promise<any>) => operation(),
     circuitBreakerOptions
   );

   // Monitor circuit state
   redisCircuitBreaker.on("open", () => {
     console.error("🔴 Circuit breaker OPENED - Redis unavailable");
   });

   redisCircuitBreaker.on("halfOpen", () => {
     console.warn("🟡 Circuit breaker HALF-OPEN - Testing Redis");
   });

   redisCircuitBreaker.on("close", () => {
     console.log("🟢 Circuit breaker CLOSED - Redis healthy");
   });
   ```

   Update `apps/api/src/services/queueService.ts`:
   ```typescript
   import { redisCircuitBreaker } from "@ticket-hive/lib";
   import { AppError, ErrorCode } from "@ticket-hive/lib";

   export async function createBookingJob(data: BookingJobData): Promise<string> {
     // Check circuit breaker state
     if (redisCircuitBreaker.opened) {
       throw new AppError(
         ErrorCode.SERVICE_UNAVAILABLE,
         "Queue temporarily unavailable. Please try again later."
       );
     }

     // Execute with circuit breaker protection
     return await redisCircuitBreaker.fire(async () => {
       const validatedData = BookingJobSchema.parse(data);
       const jobId = `booking-${randomUUID()}`;

       await bookingQueue.add("process-booking", validatedData, { jobId });

       return jobId;
     });
   }
   ```

3. **Queue Depth Check**

   Update `apps/api/src/services/queueService.ts`:
   ```typescript
   import { env } from "@ticket-hive/lib";

   export async function createBookingJob(data: BookingJobData): Promise<string> {
     // Check queue depth (prevent overload)
     const queueDepth = await bookingQueue.count();

     if (queueDepth > 1000) {
       throw new AppError(
         ErrorCode.QUEUE_FULL,
         "System at capacity. Please try again in a moment."
       );
     }

     // ... rest of logic
   }
   ```

4. **Update Environment Configuration**

   Update `packages/lib/src/env.ts`:
   ```typescript
   export const env = createEnv({
     server: {
       // ... existing config

       // Rate limiting
       RATE_LIMIT_WINDOW_MS: z.coerce.number().default(60000), // 1 min
       RATE_LIMIT_MAX_REQUESTS: z.coerce.number().default(10),

       // Circuit breaker
       CIRCUIT_BREAKER_TIMEOUT: z.coerce.number().default(3000),
       CIRCUIT_BREAKER_ERROR_THRESHOLD: z.coerce.number().default(50),
       CIRCUIT_BREAKER_RESET_TIMEOUT: z.coerce.number().default(30000),

       // Queue depth
       REDIS_QUEUE_MAX_DEPTH: z.coerce.number().default(1000),
     },
     runtimeEnv: process.env,
   });
   ```

5. **Comprehensive Error Handling**

   Update `packages/lib/src/errors.ts`:
   ```typescript
   export const ErrorCode = {
     // ... existing codes
     RATE_LIMIT_EXCEEDED: "RATE_LIMIT_EXCEEDED",
     SERVICE_UNAVAILABLE: "SERVICE_UNAVAILABLE",
     QUEUE_FULL: "QUEUE_FULL",
   } as const;
   ```

   Update `packages/lib/src/errorHandler.ts`:
   ```typescript
   export function handleError(error: unknown, res: Response) {
     // ... existing error handling

     if (error instanceof AppError) {
       const statusMap: Record<string, number> = {
         RATE_LIMIT_EXCEEDED: 429,
         SERVICE_UNAVAILABLE: 503,
         QUEUE_FULL: 503,
         // ... existing mappings
       };

       const status = statusMap[error.code] || 500;

       return res.status(status).json({
         success: false,
         error: {
           code: error.code,
           message: error.message,
         },
       });
     }

     // ... rest of error handling
   }
   ```

6. **10K Load Testing**

   Update `tests/load-test.ts`:
   ```typescript
   /**
    * Level 3 Load Test - 10,000 Concurrent Requests
    *
    * Tests:
    * - API response time <100ms
    * - Zero timeouts
    * - Rate limiting effectiveness
    * - Circuit breaker behavior
    * - Data integrity (no overbookings)
    */

   async function level3LoadTest() {
     const concurrentRequests = 10000;
     const event = await createEvent("Load Test Event", 100);

     console.log(
       `🚀 Starting Level 3 load test: ${concurrentRequests} requests`
     );
     console.log(`Event: ${event.id} (100 tickets)\n`);

     const startTime = Date.now();
     const promises: Promise<any>[] = [];

     for (let i = 0; i < concurrentRequests; i++) {
       promises.push(
         createBooking(event.id).catch((error) => ({
           error: error.message,
           status: error.response?.status,
         }))
       );
     }

     const results = await Promise.allSettled(promises);
     const duration = Date.now() - startTime;

     // Analyze results
     const successful = results.filter(
       (r) => r.status === "fulfilled" && r.value.success
     );
     const rateLimited = results.filter(
       (r) => r.status === "fulfilled" && r.value.status === 429
     );
     const queueFull = results.filter(
       (r) => r.status === "fulfilled" && r.value.status === 503
     );
     const timeouts = results.filter((r) => r.status === "rejected");

     console.log("📊 LEVEL 3 LOAD TEST RESULTS\n");
     console.log(`Total Requests: ${concurrentRequests}`);
     console.log(`Duration: ${duration}ms`);
     console.log(`Avg Response Time: ${duration / concurrentRequests}ms`);
     console.log(`\nAccepted (202): ${successful.length}`);
     console.log(`Rate Limited (429): ${rateLimited.length}`);
     console.log(`Queue Full (503): ${queueFull.length}`);
     console.log(`Timeouts: ${timeouts.length}`);

     // Wait for workers to process
     console.log("\n⏳ Waiting for workers to process jobs...");
     await new Promise((resolve) => setTimeout(resolve, 30000)); // 30s

     // Check final bookings
     const bookings = await getBookingCount(event.id);
     console.log(`\n✅ Final Bookings: ${bookings}`);
     console.log(`Expected: 100`);
     console.log(`Data Integrity: ${bookings === 100 ? "✅ PASS" : "❌ FAIL"}`);
   }
   ```

**Expected Output**:
- ✅ Rate limiting enforced (429 after 10 requests/min)
- ✅ Circuit breaker opens when Redis fails (503 immediately)
- ✅ Queue depth check prevents overload (503 when >1000 jobs)
- ✅ 10K load test: 0% timeouts, <100ms API response
- ✅ Data integrity: Exactly 100 bookings

**Validation**:
```bash
# Test rate limiting
for i in {1..15}; do
  curl -X POST http://localhost:3000/api/v1/bookings \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"eventId": "EVENT_ID"}'
  echo ""
done
# First 10: 202 Accepted
# Next 5: 429 Too Many Requests

# Test circuit breaker
docker compose stop redis
curl -X POST http://localhost:3000/api/v1/bookings \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"eventId": "EVENT_ID"}'
# Expected: 503 Service Unavailable (immediately, no hanging)

docker compose start redis
# Wait 30 seconds for circuit to close

# Run 10K load test
npm run test:load
# Expected:
# - Avg response: <100ms
# - Timeouts: 0
# - Final bookings: 100
```

**Files Modified/Created**:
- `apps/api/src/middleware/rate-limit.ts` (NEW - rate limiting)
- `packages/lib/src/redis.ts` (add circuit breaker)
- `packages/lib/src/env.ts` (add resilience config)
- `packages/lib/src/errors.ts` (add error codes)
- `packages/lib/src/errorHandler.ts` (handle new errors)
- `apps/api/src/routes/bookings.ts` (apply rate limiting)
- `apps/api/src/services/queueService.ts` (circuit breaker + queue depth)
- `tests/load-test.ts` (update for 10K requests)

---

### **Milestone 10: Separate BullMQ Dashboard Service**

**Objective**: Create a separate dashboard service for monitoring queues, decoupled from API service.

**Why Separate?**: Security. The dashboard exposes sensitive queue data and should NOT be publicly accessible. Only start it when needed for debugging.

**Tasks**:

1. **Dashboard Service**

   Install dependency:
   ```bash
   npm install @bull-board/express @bull-board/api
   ```

   Create `apps/dashboard/src/index.ts`:
   ```typescript
   import express from "express";
   import { createBullBoard } from "@bull-board/api";
   import { BullMQAdapter } from "@bull-board/api/bullMQAdapter";
   import { ExpressAdapter } from "@bull-board/express";
   import { bookingQueue } from "@ticket-hive/lib";
   import { env } from "@ticket-hive/lib";

   /**
    * BullMQ Dashboard Service
    *
    * SECURITY WARNING:
    * - This service exposes sensitive queue data
    * - Only run in development or behind VPN
    * - In production, use external monitoring instead
    */

   const app = express();
   const serverAdapter = new ExpressAdapter();
   serverAdapter.setBasePath("/");

   createBullBoard({
     queues: [new BullMQAdapter(bookingQueue)],
     serverAdapter: serverAdapter,
   });

   app.use("/", serverAdapter.getRouter());

   const PORT = 3001;
   app.listen(PORT, () => {
     console.log(`📊 BullMQ Dashboard running at http://localhost:${PORT}`);
     console.log("⚠️  WARNING: For development use only!");
   });
   ```

   Create `apps/dashboard/package.json`:
   ```json
   {
     "name": "@ticket-hive/dashboard",
     "version": "1.0.0",
     "type": "module",
     "scripts": {
       "dev": "node --watch --experimental-transform-types --env-file=../../.env.local ./src/index.ts",
       "build": "tsc --noEmit",
       "start": "node --experimental-transform-types ./src/index.ts"
     },
     "dependencies": {
       "@ticket-hive/lib": "*",
       "@bull-board/api": "^5.0.0",
       "@bull-board/express": "^5.0.0",
       "express": "^4.18.2"
     }
   }
   ```

2. **Docker Service (Optional)**

   Update `compose.yaml`:
   ```yaml
   services:
     # ... existing services

     dashboard:
       build:
         context: .
         target: development
       command: node --experimental-transform-types --env-file=/run/secrets/.env.docker apps/dashboard/src/index.ts
       ports:
         - "3001:3001"
       volumes:
         - ./apps/dashboard/src:/usr/src/app/apps/dashboard/src
         - ./packages:/usr/src/app/packages
         - ./secrets/.env.docker:/run/secrets/.env.docker:ro
       environment:
         PORT: 3001
       depends_on:
         - redis
       profiles:
         - monitoring  # Only start when explicitly requested
       restart: unless-stopped
   ```

3. **Security Documentation**

   Create `docs/dashboard-security.md`:
   ```markdown
   # BullMQ Dashboard Security

   ## ⚠️ IMPORTANT SECURITY NOTICE

   The BullMQ dashboard exposes:
   - Job data (user IDs, event IDs, etc.)
   - Queue metrics
   - Worker performance
   - Failed job details

   ## Development Use

   Start dashboard locally:
   \`\`\`bash
   # Option 1: Docker (recommended)
   docker compose --profile monitoring up -d dashboard

   # Option 2: Local
   cd apps/dashboard
   npm run dev
   \`\`\`

   Access: http://localhost:3001

   ## Production Recommendations

   **Option 1: Don't deploy it**
   - Use external monitoring (DataDog, New Relic) instead
   - Safer and more feature-rich

   **Option 2: Deploy with auth**
   - Add authentication middleware
   - Restrict to VPN/internal network only
   - Use environment-based feature flag

   **Option 3: On-demand only**
   - Only start for debugging sessions
   - Stop immediately after use
   - Never expose publicly

   ## Example: Adding Basic Auth

   \`\`\`typescript
   import basicAuth from "express-basic-auth";

   app.use(
     basicAuth({
       users: { admin: process.env.DASHBOARD_PASSWORD! },
       challenge: true,
     })
   );
   \`\`\`
   ```

**Expected Output**:
- ✅ Dashboard accessible at `http://localhost:3001`
- ✅ Shows queue depth, job status, processing times
- ✅ Does NOT start by default (opt-in with `--profile monitoring`)
- ✅ API service does NOT mount dashboard
- ✅ Security warnings documented

**Validation**:
```bash
# Start dashboard explicitly
docker compose --profile monitoring up -d dashboard

# Access dashboard
open http://localhost:3001

# Should show:
# - Booking queue status
# - Active jobs
# - Completed jobs
# - Failed jobs
# - Worker metrics

# Verify API does NOT have dashboard
curl http://localhost:3000/admin/queues
# Expected: 404 Not Found

# Stop monitoring services
docker compose --profile monitoring down
```

**Files Modified/Created**:
- `apps/dashboard/src/index.ts` (NEW - dashboard entry)
- `apps/dashboard/package.json` (NEW)
- `compose.yaml` (add dashboard service with profile)
- `docs/dashboard-security.md` (NEW - security guide)

---

## ✅ Production Completion Criteria

After completing Milestones 7-10, your system should have:

### Real-Time Updates
- ✅ SSE delivers status updates (no polling needed)
- ✅ "Fast Worker" edge case handled (state check before subscribe)
- ✅ Works with multiple API instances (QueueEvents)
- ✅ Auto-reconnection on disconnect

### Resilience
- ✅ Rate limiting enforced (10 req/min per user)
- ✅ Circuit breaker returns 503 when Redis down (hard fail, no degradation)
- ✅ Queue depth check prevents overload
- ✅ Comprehensive error handling with user-friendly messages

### Monitoring
- ✅ BullMQ dashboard available (opt-in, secured)
- ✅ Metrics tracked: queue depth, processing time, conflict rate
- ✅ Circuit breaker state changes logged

### Performance
- ✅ 10K concurrent requests handled
- ✅ 0% timeout rate
- ✅ API response <100ms
- ✅ Worker processing 200-500ms avg
- ✅ Zero overbookings

### Security
- ✅ Dashboard not exposed publicly
- ✅ Rate limiting prevents abuse
- ✅ Circuit breaker prevents cascading failures

---

## 📊 Production Metrics

| Metric | Target | Validation Method |
|--------|--------|-------------------|
| API Response Time (p95) | <100ms | Load test timing |
| API Response Time (p99) | <150ms | Load test timing |
| Worker Processing Time | 200-500ms | BullMQ dashboard |
| Queue Depth Under Load | <50 avg | BullMQ dashboard |
| Timeout Rate | 0% | Load test results |
| Rate Limit Effectiveness | 100% | Manual test (15 rapid requests) |
| Circuit Breaker Opens | Within 3s | Redis stop test |
| Data Integrity | 100% | Database verification |
| SSE Delivery Rate | 100% | Fast worker test |

---

## 🎓 Production Demo Script

After completing production hardening:

```bash
# 1. Show all services running
docker compose ps
# Should show: db, redis, server (API), worker, (optional: dashboard)

# 2. Start dashboard for monitoring
docker compose --profile monitoring up -d dashboard
open http://localhost:3001

# 3. Create test event (100 tickets)
# ... (same as MVP demo)

# 4. Create booking with SSE
node --experimental-transform-types examples/sse-client.html
# Should show real-time updates in browser

# 5. Test rate limiting
for i in {1..15}; do
  curl -X POST http://localhost:3000/api/v1/bookings \
    -H "Authorization: Bearer $TOKEN" \
    -d '{"eventId": "EVENT_ID"}'
done
# First 10: 202 Accepted
# Next 5: 429 Too Many Requests

# 6. Test circuit breaker
docker compose stop redis
curl -X POST http://localhost:3000/api/v1/bookings \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"eventId": "EVENT_ID"}'
# Expected: 503 Service Unavailable (immediately)

docker compose start redis
# Wait 30 seconds for circuit to close

# 7. Run 10K load test
npm run test:load
# Should show:
# - Total Requests: 10,000
# - Avg Response: <100ms
# - Timeouts: 0
# - Rate Limited: ~9,000 (expected)
# - Accepted: ~100 (expected)
# - Final Bookings: 100 ✅

# 8. Show dashboard metrics
open http://localhost:3001
# Review:
# - Queue depth stayed low
# - Worker processed efficiently
# - No failed jobs (or minimal retries)
```

---

## 🚨 Production Pitfalls to Avoid

1. **Exposing dashboard publicly** - Major security risk
2. **No rate limiting** - Queue overflow and abuse vectors
3. **Graceful degradation** - Adds complexity, harder to reason about failures
4. **Not testing Redis failures** - Circuit breaker untested until production incident
5. **Polling instead of SSE** - Wastes resources, poor user experience
6. **Not handling fast workers** - SSE clients hang indefinitely
7. **Hardcoded limits** - Production tuning requires code changes
8. **No cleanup on disconnect** - Memory leaks from orphaned SSE connections

---

## 📝 Production Implementation Checklist

**Real-Time Updates**:
- [ ] Milestone 7: SSE implementation
- [ ] Test SSE with multiple clients
- [ ] Test with multiple API instances
- [ ] Verify auto-reconnection

**Edge Cases**:
- [ ] Milestone 8: Fix "Fast Worker" race
- [ ] Test late-joining clients
- [ ] Verify state check logic

**Resilience**:
- [ ] Milestone 9: Add rate limiting
- [ ] Implement circuit breaker
- [ ] Add queue depth check
- [ ] Update error handling
- [ ] Run 10K load test

**Monitoring**:
- [ ] Milestone 10: Create dashboard service
- [ ] Configure as opt-in (profile)
- [ ] Document security considerations
- [ ] Test dashboard shows metrics

**Final Validation**:
- [ ] SSE delivers updates reliably
- [ ] Rate limiting prevents abuse
- [ ] Circuit breaker opens on Redis failure
- [ ] Queue depth stays manageable
- [ ] 10K load test passes
- [ ] Zero overbookings
- [ ] Dashboard secured

---

## 🔗 Related Documents

- **LEVEL_3_MVP_PLAN.md** - Foundation (Milestones 0-6)
- **LEVEL_3_COMPLETE_PLAN.md** - Full plan (both MVP and Production)
- **SPECS.md** - Original project requirements

---

## 🎯 Next Steps After Production

**You now have a production-ready Level 3 system!**

Consider these next steps:

1. **Portfolio Presentation**
   - Record demo video showing SSE, rate limiting, circuit breaker
   - Write technical blog post explaining optimistic locking trade-offs
   - Create architecture diagram for resume

2. **Level 4 (Optional)**
   - Idempotency (prevent duplicate bookings)
   - Distributed locking with Redlock (seat selection)
   - Advanced monitoring (metrics, alerting)

3. **Real Deployment**
   - Deploy to cloud (AWS, GCP, Render)
   - Set up CI/CD pipeline
   - Configure production environment variables
   - Monitor in production

4. **Interview Prep**
   - Be ready to explain:
     - Optimistic vs pessimistic locking trade-offs
     - Why QueueEvents over raw Redis Pub/Sub
     - Circuit breaker pattern and hard fail decision
     - SSE race condition and solution

---

*Last updated: 2025-01-27*
*Status: Ready for implementation after MVP complete*
