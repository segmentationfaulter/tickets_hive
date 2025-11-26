# TicketHive - AI Coding Agent Guide

## Project Overview

**TicketHive** is a high-concurrency event booking system built to handle flash sale scenarios (like Taylor Swift tickets) with thousands of users competing for limited inventory. The project demonstrates progressive levels of concurrency control, currently at **Level 2** (transaction-based with pessimistic locking).

### 🎯 Core Objectives
- Handle 1000+ concurrent users booking tickets simultaneously
- Maintain 100% data integrity (zero overbookings)
- Provide immediate API responses with transactional guarantees
- Graceful error handling and user-friendly error messages

### 🛠️ Technology Stack
- **Runtime**: Node.js with TypeScript (ES modules)
- **Framework**: Express.js
- **Database**: PostgreSQL (postgres.js driver)
- **Authentication**: JWT with bcrypt hashing
- **Containerization**: Docker & Docker Compose
- **Testing**: Load testing with 1000 concurrent requests

### 📊 Current Implementation Level: Level 2

**Level 2** uses PostgreSQL transactions with pessimistic locking (`FOR UPDATE`) to eliminate race conditions:

```typescript
// Key pattern: FOR UPDATE locks prevent concurrent access
const events = await transaction`
  SELECT id, available_tickets
  FROM events
  WHERE id = ${eventId}
  FOR UPDATE  // 🔒 Critical for preventing race conditions
`;
```

**Trade-offs**:
- ✅ 100% data integrity, zero overbookings
- ✅ Simple implementation using built-in database features  
- ⚠️ Lower throughput (requests serialize on locked rows)
- ⚠️ 1-2% timeout rate under extreme load (statement_timeout: 5s)

**Level 3 (In Progress)**: Queue-based async processing with BullMQ + Redis

Level 3 implementation is now actively planned. See `docs/level3/LEVEL_3_COMPLETE_PLAN.md` for detailed implementation strategy and requirements.

---

## Project Structure

### Monorepo Organization (Post-Milestone 0)

```
tickets-hive/
├── apps/                       # 🚀 Deployable applications
│   ├── api/                   # Express API service
│   │   ├── package.json
│   │   └── src/
│   │       ├── index.ts       # Express app entry point
│   │       ├── routes/        # HTTP route handlers
│   │       │   ├── auth.ts
│   │       │   ├── events.ts
│   │       │   └── bookings.ts
│   │       ├── services/      # Business logic (API-specific)
│   │       │   ├── authService.ts
│   │       │   ├── eventService.ts
│   │       │   └── queueService.ts  # Queue job producers (Level 3)
│   │       └── middleware/    # Express middleware
│   │           ├── verify-token.ts
│   │           └── require-admin.ts
│   └── worker/                # BullMQ worker service (Level 3)
│       ├── package.json
│       └── src/
│           ├── index.ts       # Worker entry point
│           └── processors/    # Job processors
│               └── bookingProcessor.ts
├── packages/                  # 📦 Shared libraries
│   ├── database/              # PostgreSQL client & schema
│   │   ├── package.json
│   │   └── src/
│   │       ├── index.ts       # Main exports
│   │       ├── db.ts          # postgres.js connection
│   │       └── schema.ts      # Database initialization
│   ├── types/                 # Shared TypeScript types
│   │   ├── package.json
│   │   └── src/
│   │       ├── index.ts       # Type exports
│   │       ├── auth.ts
│   │       ├── event.ts
│   │       └── booking.ts
│   └── lib/                   # Shared utilities
│       ├── package.json
│       └── src/
│           ├── index.ts       # Main exports
│           ├── errors.ts      # Error codes & AppError
│           ├── errorHandler.ts
│           ├── auth.ts        # JWT utilities
│           └── env.ts         # Environment validation
├── docs/                      # Documentation
│   ├── SPECS.md              # Main specification (MOST IMPORTANT)
│   └── level3/
│       ├── LEVEL_3_COMPLETE_PLAN.md    # Full Level 3 plan
│       └── milestone-0-implementation-plan.md  # Milestone 0 plan
├── tests/                     # Test suites
│   └── load-test.ts          # 1000 concurrent request load test
├── secrets/                   # Docker secrets (mounted at runtime)
│   ├── db_password.txt
│   └── jwt_secret.txt
├── docker-compose.yml        # PostgreSQL + API + Redis services
├── Dockerfile                # Multi-stage monorepo build
├── package.json              # Root dependencies & workspace config
├── turbo.json                # Build orchestration
└── tsconfig.json             # TypeScript configuration with path mapping
```

---

## Specification & Implementation Status

This project is implementing the **official specification** at **`docs/SPECS.md`**. This specification defines four progressive levels of implementation:

- **Level 1 (Junior)**: Basic CRUD operations - ✅ **IMPLEMENTED**
- **Level 2 (Mid-Level)**: Database transactions with pessimistic locking - ✅ **IMPLEMENTED**  
- **Level 3 (Senior)**: Queue-based async processing with BullMQ & Redis - 🔄 **IN PROGRESS**
  - Implementation plan: `docs/level3/LEVEL_3_COMPLETE_PLAN.md`
  - Specification: `docs/SPECS.md` (Level 3 section)
- **Level 4 (Principal)**: Idempotency & distributed locking for resilience - 📋 **PLANNED**

**IMPORTANT**: Always refer to `docs/SPECS.md` first when working on this project. It contains the canonical requirements and architecture decisions for each level.

---

## Database Schema

### PostgreSQL Tables & Types

```sql
-- Enum types
CREATE TYPE user_role AS ENUM ('user', 'admin');
CREATE TYPE booking_status AS ENUM ('CONFIRMED', 'CANCELLED');

-- Users table
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  name VARCHAR(255) NOT NULL,
  role user_role DEFAULT 'user',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Events table (core for concurrency testing)
CREATE TABLE IF NOT EXISTS events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  total_tickets INT NOT NULL,
  available_tickets INT NOT NULL,  -- Decremented atomically via FOR UPDATE
  event_date TIMESTAMP NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Bookings table (links users to events)
CREATE TABLE IF NOT EXISTS bookings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  status booking_status NOT NULL DEFAULT 'CONFIRMED',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

### Database Connection Configuration (Critical)

Located in `src/lib/db.ts` - **Never change without understanding impact**:

```typescript
const sql = postgres({
  max: 20,                    // Connection pool size
  idle_timeout: 30,           // Close idle connections after 30s
  connect_timeout: 10,        // 10s connection timeout
  connection: {
    statement_timeout: 5000,  // 🔴 5s query timeout - CRITICAL for preventing lock hell
  },
});
```

**Why statement_timeout = 5000ms?**
- Normal booking: <100ms
- High contention: 100-500ms waiting for FOR UPDATE locks
- Extreme load: Some requests timeout after 5s (prevents cascading delays)
- If >20% timeout rate, the system needs Level 3 (queues) 

---

## Build & Development Commands

### Local Development

```bash
# Install dependencies
npm install

# Start PostgreSQL + API in Docker
docker compose up -d

# Development mode (file watching)
npm run dev
# Runs: node --watch src/index.ts

# Debug mode with inspector
npm run debug
# Runs: node --inspect=0.0.0.0:9229 src/index.ts
# Connect Chrome DevTools to localhost:9229

# Run load test (ensure services are running first)
npm run test:load
# Runs: node tests/load-test.ts
# Creates event with 100 tickets, fires 1000 concurrent requests
```

### Docker Operations

```bash
# View logs
docker compose logs -f
docker compose logs -f db    # Database logs only
docker compose logs -f server # API logs only

# Check database status
docker compose exec db pg_isready

# Connect to database directly
docker compose exec db psql -U tickethive_user -d tickethive

# Restart services
docker compose restart

# Stop everything
docker compose down

# Destroy volumes (reset database)
docker compose down -v
```

### Database Management

The app automatically initializes schema on startup (see `initializeDatabase()` in `packages/database/src/index.ts`):

```bash
# Manual schema reset (development only)
# 1. Stop services
docker compose down -v

# 2. Remove volume data
rm -rf db-data/

# 3. Restart
docker compose up -d
```

---

## Code Style Guidelines

### TypeScript Patterns

**1. ES Modules Only**
- Use `import`/`export` syntax
- File extensions required: `import sql from "../lib/db.ts"`
- No CommonJS (`require()`, `module.exports`)

**2. Service Layer Pattern**
All business logic in `apps/api/src/services/` (API-specific) or `apps/worker/src/processors/` (worker-specific) with error classification:

```typescript
// ✅ Good: Service handles business logic, route handles HTTP
const booking = await bookingService.createBooking(userId, payload);
res.status(201).json({ success: true, data: booking });

// ❌ Bad: Business logic in routes
if (!event.available_tickets) {  // This check belongs in service
  return res.status(409).json({ error: "Sold out" });
}
```

**3. Error Handling Strategy**
Three-layer error architecture:

```typescript
// 1. Database Layer: PostgreSQL errors → AppError conversion
// 2. Service Layer: Throw AppError with specific codes
throw new AppError(ErrorCode.EVENT_SOLD_OUT);

// 3. Route Layer: handleError formats as HTTP response
handleError(error, res, "createBooking");
```

**4. Type Safety**
- Use Zod for runtime validation (request payloads, params)
- Define TypeScript interfaces in `packages/types/src/`
- Import types from shared packages: `import type { Event } from '@ticket-hive/types'`
- Never use `any` or `as` assertions without justification

**5. Database Transactions**
Use `sql.begin()` for all multi-step operations:

```typescript
return await sql.begin(async (transaction) => {
  // Step 1: Lock row with FOR UPDATE
  const events = await transaction`SELECT ... FOR UPDATE`;
  
  // Step 2: Business logic
  if (event.available_tickets <= 0) throw new AppError(...);
  
  // Step 3: Update (automatically rolled back on error)
  await transaction`UPDATE events ...`;
  
  // Step 4: Insert (rolled back if Event 3 fails)
  const bookings = await transaction`INSERT INTO bookings ...`;
  
  return bookings[0];  // Auto-commit on success
});
```

### Naming Conventions

- **Files**: `kebab-case.ts` (e.g., `booking-service.ts`, `verify-token.ts`)
- **Functions**: `camelCase` (e.g., `createBooking`, `handleError`)
- **Constants**: `UPPER_SNAKE_CASE` (e.g., `ErrorCode.EVENT_SOLD_OUT`)
- **Types/Interfaces**: `PascalCase` (e.g., `CreateBookingPayload`, `Booking`)
- **Environment Variables**: `SCREAMING_SNAKE_CASE` (e.g., `POSTGRES_HOST`)

### Commenting Standards

**Every service method needs a Level X implementation comment** explaining:

```typescript
/**
 * Level 2 Implementation: Database Transaction with Pessimistic Locking
 * 
 * How it works:
 * 1. BEGIN TRANSACTION
 * 2. SELECT ... FOR UPDATE ← Locks the row
 * 3. Check availability
 * 4. UPDATE events
 * 5. INSERT INTO bookings
 * 6. COMMIT
 * 
 * Trade-offs:
 * ✅ 100% data integrity
 * ⚠️ Lower throughput (serialization on locks)
 * 
 * Why FOR UPDATE is critical: [explain the race condition it prevents]
 * 
 * Error Handling Strategy: [explain error flow]
 */
```

---

## Testing Strategy

### Load Test (`tests/load-test.ts`)

**Purpose**: Verify zero overbookings under extreme concurrency

**What it does**:
1. Registers a test user (upgrades to admin)
2. Creates event with 100 tickets using admin token
3. Fires 1000 concurrent booking requests
4. Validates results against database

**Run it**:
```bash
docker compose up -d    # Must be running first
npm run test:load       # Takes ~30-60 seconds
```

**Expected Output (Level 2)**:
```
📊 LOAD TEST RESULTS - Level 2 (Transaction + Timeout Handling)

📈 Request Metrics:
  Total Requests: 1000
  Successful Bookings (201): 100 (10.0%)     ✅ Exactly as expected
  Sold Out (409): 880-890 (88-89%)           ✅ Expected behavior
  Timeouts (503): 10-20 (1-2%)               ⚠️  Acceptable under load
  HTTP Success Rate: 98%                     ✅ Great!

🎟️  Data Integrity:
  Expected Bookings: 100
  Actual Bookings: 100    ✅ Perfect match
  Available Tickets: 0    ✅ No negative numbers

✅ Race Condition Analysis:
  🟢 RACE CONDITION: NONE ✅
     - Exact match: 100 == 100
     - No negative tickets: 0 >= 0
```

**Key Metrics to Monitor**:
- **Actual Bookings** must equal **Expected Bookings** (100 == 100)
- **Available Tickets** must never be negative
- Timeout rate should be 1-2% (acceptable) not >20% (problematic)
- Response time ~800-1500ms is normal for Level 2

### Manual Testing Queries

After load test, run these queries to verify data integrity:

```sql
-- Verify exactly 100 bookings created
SELECT COUNT(*) FROM bookings WHERE created_at > NOW() - INTERVAL '5 minutes';

-- Check no negative ticket counts
SELECT name, total_tickets, available_tickets 
FROM events 
WHERE available_tickets < 0;
-- Should return 0 rows

-- Validate booking accuracy
SELECT 
  e.name,
  e.total_tickets,
  e.available_tickets,
  COUNT(b.id) as actual_bookings,
  (e.total_tickets - e.available_tickets) as expected_bookings
FROM events e
LEFT JOIN bookings b ON b.event_id = e.id AND b.status = 'CONFIRMED'
WHERE e.available_tickets < 100  -- Find recently created test events
GROUP BY e.id;
-- actual_bookings MUST equal expected_bookings
```

---

## Error Handling & HTTP Status Codes

### Business Logic Errors (4xx - Client Errors)

Expected errors caused by invalid requests:

| Error Code | Status | When to Return | User Action |
|------------|--------|----------------|-------------|
| `EVENT_NOT_FOUND` | 404 | Event ID doesn't exist | Check event ID |
| `EVENT_SOLD_OUT` | 409 | No tickets available | Try different event |
| `BOOKING_ALREADY_CANCELLED` | 409 | Double cancel attempt | Don't retry |
| `INVALID_CREDENTIALS` | 401 | Wrong email/password | Update credentials |
| `EMAIL_ALREADY_REGISTERED` | 409 | Duplicate registration | Use different email |

**Characteristics**:
- Part of **normal operation**
- Should **NOT** trigger alerts
- Do **NOT** retry (same request will fail again)

### Infrastructure Errors (5xx - Server Errors)

Exceptional errors indicating system problems:

| Error Code | Status | When to Return | User Action |
|------------|--------|----------------|-------------|
| `STATEMENT_TIMEOUT` | 503 | Database overloaded | **Retry with backoff** |
| `DATABASE_CONNECTION_ERROR` | 503 | Can't reach database | **Retry with backoff** |
| `INTERNAL_SERVER_ERROR` | 500 | Unexpected bug | Report to developers |

**Characteristics**:
- Should be **RARE** (< 5% of requests)
- **Should trigger alerts** (PagerDuty, etc.)
- **CAN retry** (may succeed on retry)
- Not the user's fault

### Three-Layer Error Architecture

```
Database Layer → Service Layer → Route Layer → Client
     ↓              ↓              ↓            ↓
PostgresError   AppError       HTTP         JSON
(code 57014)  (code string)  Status       Response

Example flow:
1. PostgreSQL: PostgresError code 57014 (timeout)
2. Service: Let it propagate (infrastructure error)
3. Route: handleError() → { code: "STATEMENT_TIMEOUT", message: "High traffic..." }
4. Client: 503 with friendly retry message
```

**Never expose technical error details to users!**

```typescript
// ❌ DON'T: Expose PostgreSQL internals
{
  "error": "PostgresError: canceling statement due to statement timeout",
  "code": 57014,
  "routine": "ProcessInterrupts"
}

// ✅ DO: User-friendly message
{
  "success": false,
  "error": {
    "code": "STATEMENT_TIMEOUT",
    "message": "High traffic detected. Please try again in a moment."
  }
}
```

---

## Security Considerations

### Authentication & Authorization

**JWT Implementation** (`packages/lib/src/auth.ts`):
- Bearer token in `Authorization` header
- Secret stored in Docker secret: `/run/secrets/jwt_secret`
- Default expiration: 24 hours (configurable via `JWT_EXPIRATION`)
- Middleware: `verifyJWT` extracts token, validates, adds `req.user`

**Role-Based Access Control**:
- `user` role: Can book tickets, view events
- `admin` role: Can create events (via `require-admin` middleware)
- Admin upgraded via database: `UPDATE users SET role = 'admin' WHERE email = ?`

### Database Security

**Password Management**:
- **Never hardcode passwords**
- Docker secrets mounted at runtime: `/run/secrets/db_password`
- File read on startup (`fs.readFileSync(env.POSTGRES_PASSWORD_FILE)`)
- Application exits immediately if password file missing

**Connection String Security**:
- No database URLs with embedded credentials
- Password passed separately to postgres.js driver
- Connection encrypted in Docker network (internal service communication)

### Injection Prevention

**SQL Injection**: Protected by postgres.js tagged template literals:

```typescript
// ✅ Safe: postgres.js handles parameterization automatically
const events = await sql`
  SELECT * FROM events WHERE id = ${userInput}
`;

// ❌ Dangerous: Manual concatenation (NEVER do this)
const events = await sql(`SELECT * FROM events WHERE id = '${userInput}'`);
```

**No ORM**: Direct SQL with postgres.js eliminates ORM injection vectors while maintaining type safety.

### Rate Limiting & DDoS

**Current State**: No built-in rate limiting (Level 2 limitation)

**Level 3 Enhancement**: Rate limiting will be added as part of queue-based architecture
```typescript
- Per-user: 10 requests/minute
- Per-IP: 100 requests/minute
- Queue-based backpressure per Level 3 specification
```

**Production Recommendations**:
- Add reverse proxy (nginx) with rate limiting
- Cloudflare / AWS WAF for DDoS protection
- API gateway with throttling (Kong, Zuplo)

---

## Deployment & Operations

### Docker Compose Architecture

**Current (Level 2) - Single Service:**
```yaml
services:
  server:
    build:
      context: .
      target: development  # Uses native TypeScript support (Node.js 24+)
    ports:
      - "3000:3000"  # API
      - "9229:9229"  # Debugger
    secrets:
      - db-password    # Mounted at /run/secrets/db_password
      - jwt-secret     # Mounted at /run/secrets/jwt_secret
    volumes:
      - ./apps/api/src:/usr/src/app/apps/api/src    # Monorepo structure
      - ./packages:/usr/src/app/packages          # Shared code
    depends_on:
      db:
        condition: service_healthy
  
  db:
    image: postgres:16
    volumes:
      - db-data:/var/lib/postgresql/data  # Persistent storage
    healthcheck:
      test: ["CMD", "pg_isready"]
      interval: 10s
      timeout: 5s
      retries: 5
```

**Level 3 (In Progress) - Full Queue Architecture:**
```yaml
# Extended configuration adding Redis + Worker services
services:
  server:  # API service (unchanged from above)
    # ... same as above
  
  worker:  # NEW: BullMQ worker service
    build:
      context: .
      target: development
    command: node --experimental-transform-types apps/worker/src/index.ts
    depends_on:
      - db
      - redis
    environment:  # Same as API but no ports exposed
      # ... environment variables
    volumes:  # Same volume mounts as API
      - ./apps/worker/src:/usr/src/app/apps/worker/src
      - ./packages:/usr/src/app/packages
    secrets:
      - db-password
      - jwt-secret
    # No ports - worker is internal only
  
  redis:  # NEW: Redis for BullMQ queue + dashboard
    image: redis:7-alpine
    ports:
      - "6379:6379"  # Redis default
    volumes:
      - redis-data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
  
  db:  # PostgreSQL (unchanged)
    # ... same as above

volumes:
  db-data:
  redis-data:  # NEW for Redis
```

**Docker Secrets**:
- `db-password`: PostgreSQL password
- `jwt-secret`: JWT signing secret (32+ random characters)

**Secret files location**: `secrets/db_password.txt`, `secrets/jwt_secret.txt`

### Multi-Stage Build

**Development Stage** (Node.js 24+ with native TypeScript):
- Installs all dependencies (including dev)
- Runs TypeScript source files directly (no compilation)
- Uses `--experimental-transform-types` for enum support
- Mounts monorepo packages for hot reloading across all apps
- No tsx, ts-node, or transpilation overhead

**Production Stage**:
- Installs only production dependencies
- Runs TypeScript source files directly (no dist/ folder)
- Smaller image size (no build artifacts)
- Single source of truth (same .ts files in dev/prod)

**Multi-Stage Docker Build:**
```dockerfile
# Build stage - Type checking
FROM node:24-alpine AS builder
WORKDIR /app
COPY package*.json tsconfig.json turbo.json ./
COPY apps/*/package.json ./apps/*/
COPY packages/*/package.json ./packages/*/
RUN npm ci
COPY . .
RUN npm run build  # Type check only (tsc --noEmit)

# Production stage - Runs TypeScript natively
FROM node:24-alpine AS production
WORKDIR /usr/src/app
COPY --from=builder /app .
CMD ["node", "--experimental-transform-types", "apps/api/src/index.ts"]
```

Build production:
```bash
docker build --target production -t tickethive:prod .
```

**Why Native TypeScript?**
- Faster startup (no transpilation)
- Simpler debugging (debug .ts files directly)
- Smaller Docker images
- Less tooling (remove tsx, ts-node, tsconfig-paths)
- Consistent behavior between dev and prod

### Environment Variables

All configuration via environment variables (validated by `@t3-oss/env-core`):

```typescript
// Required variables
PORT=3000
POSTGRES_HOST=db
POSTGRES_PORT=5432
POSTGRES_DB=tickets_hive
POSTGRES_USER=tickethive_user
POSTGRES_PASSWORD_FILE=/run/secrets/db_password
JWT_SECRET_FILE=/run/secrets/jwt_secret
JWT_EXPIRATION=24H  # Optional, defaults to 24H
```

**Never commit secrets** - use Docker secrets or environment injection.

### Health Checks & Monitoring

**Database Health**: `pg_isready` built into compose

**Application Health** (Level 3 plans to add):
```typescript
// Planned endpoints
GET /health            # API health
GET /health/db         # Database connectivity
GET /health/redis      # Redis connectivity (Level 3)
GET /health/worker     # Worker status (Level 3)
```

**Current Monitoring**:
- Database logs: `docker compose logs -f db`
- API logs: `docker compose logs -f server`
- Connection pool stats: Check `pg_stat_activity`

### Troubleshooting Common Issues

**❌ "Failed to read PostgreSQL password file"**
```bash
# Solution: Create secret files
echo "securepassword" > secrets/db_password.txt
echo "jwtsecretkey" > secrets/jwt_secret.txt
# Then: docker compose up -d
```

**❌ "Connection terminated unexpectedly"**
- Cause: Connection pool exhaustion
- Solution: Increase `max` connections in `packages/database/src/db.ts` or scale horizontally

**❌ Too many timeout errors (>20%)**
- Symptom: `STATEMENT_TIMEOUT` errors flooding logs
- Root cause: Database lock contention too high for Level 2
- Solution: Implement Level 3 (queue-based async) or reduce load

**❌ "Database initialization failed"**
- Check: `docker compose logs db` for PostgreSQL errors
- Verify: Secrets mounted correctly `docker compose exec server cat /run/secrets/db_password`
- Test: `docker compose exec db pg_isready`

---

## Future Enhancements (Level 3)

Level 3 implementation details are defined in the specification `docs/SPECS.md` and detailed in the implementation plan `docs/level3/LEVEL_3_COMPLETE_PLAN.md`.

### Key Changes from Level 2 → Level 3

**Architecture Evolution**:
```
Level 2 (Current):
Client → API → Database (FOR UPDATE locks) → Response (sync)
        └─ High latency, timeouts, serial processing

Level 3 (Planned):
Client → API → Queue job → Response (202 Accepted) → Client
                         ↓
                      Worker → Database (optimistic locking) → SSE → Client
                         └─ Low latency, no timeouts, parallel workers
```

**New Components**:
- **Redis**: BullMQ job queue storage
- **BullMQ**: Queue management and job processing
- **Booking Workers**: Separate process(es) for async processing
- **Optimistic Locking**: Version column instead of `FOR UPDATE`
- **Server-Sent Events**: Real-time status updates to clients
- **Graceful Degradation**: Fallback to Level 2 if Redis unavailable

**Performance Targets**:
- Concurrent requests: 1,000 → 10,000+
- Response time: 800-1500ms → <100ms
- Timeout rate: 1-2% → 0%
- Throughput: 200-333 req/s → 1,000+ req/s

**Why Server-Sent Events (SSE) over WebSockets?**
- Unidirectional communication (server → client) fits booking updates
- HTTP-based (works through proxies, firewalls)
- Simpler implementation than WebSockets
- Built-in browser support and auto-reconnection

For complete Level 3 requirements and implementation details, see `docs/SPECS.md` and `docs/level3/LEVEL_3_COMPLETE_PLAN.md`.

---

## Key Takeaways for AI Agents

### When Working on This Project

**1. Read the Specification First**
- Always start with `docs/SPECS.md` - it's the canonical source of requirements
- The specification defines four levels (1-4) with clear acceptance criteria
- Current implementation: Levels 1 & 2 complete, Level 3 is next

**2. Respect the Transaction Pattern**
- Every booking operation MUST use `sql.begin()`
- Always lock event/booking rows with `FOR UPDATE` before reading
- Never split operations across multiple transactions for same booking

**3. Error Code Consistency**
- Use `ErrorCode` constants from `packages/lib/src/errors.ts` (never magic strings)
- Map to correct HTTP status codes via `ERROR_METADATA`
- Distinguish business logic errors (4xx) from infrastructure errors (5xx)

**4. Never Hardcode Secrets**
- Always use environment variables or Docker secrets
- Password files must be read via `fs.readFileSync(env.POSTGRES_PASSWORD_FILE)`
- Application should fail fast if secrets unavailable

**5. Test Concurrency on Every Change**
- Run `npm run test:load` after any booking-related changes
- Verify: 100 bookings, 0 overbookings, available_tickets ≥ 0
- If timeout rate >20%, the change breaks Level 2 assumptions

**6. Documentation Comments Required**
- Every service method needs Level X implementation explanation
- Document trade-offs, why specific patterns chosen
- Reference the race condition the code prevents

**7. Database First**
- Schema changes require updating `initializeDatabase()` in `packages/database/src/schema.ts`
- Test schema initialization: `docker compose down -v && docker compose up -d`
- Indexes on foreign keys for performance (user_id, event_id)

**8. Production-Ready Mindset**
- Fails fast with clear error messages
- Structured logging (consider adding Pino for Level 3)
- Graceful degradation strategies
- Circuit breakers for external dependencies

### Common Pitfalls to Avoid

- ❌ Not reading `docs/SPECS.md` before making changes
- ❌ Removing `FOR UPDATE` from SELECT queries (reintroduces race conditions)
- ❌ Increasing `statement_timeout` beyond 5s (hides performance problems)
- ❌ Adding new endpoints without Zod validation
- ❌ Throwing generic `Error()` instead of `AppError` with specific codes
- ❌ Forgetting to add indexes on new foreign key columns
- ❌ Hardcoding credentials or environment-specific values
- ❌ Not testing under concurrent load (race conditions only appear under load)

---

## Getting Help

**Specification Source**: Always start with **`docs/SPECS.md`** - it defines all levels and requirements.

**File References**:
- Architecture details: `README.md` (730 lines of comprehensive docs)
- Level 3 implementation: `docs/level3/LEVEL_3_COMPLETE_PLAN.md` (🆕 NEW - actively planned)
- Specification: `docs/SPECS.md` (defines all levels 1-4)
- Load test results: `tests/load-test.ts` (run for current performance)

**Database queries**: Check `packages/database/src/schema.ts` for schema and `packages/database/src/db.ts` for connection logic.

**Error handling flow**: See `packages/lib/src/errors.ts` for all error codes and `packages/lib/src/errorHandler.ts` for HTTP formatting.

**Booking logic**: Core implementation in `apps/api/src/services/bookingService.ts` with extensive comments explaining transaction flow.

---

*This guide should give you complete context for working effectively on the TicketHive project. When in doubt, check the detailed comments in source files—every critical section is extensively documented.*
