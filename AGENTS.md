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
- ⚠️ Timeout handling under extreme load (statement_timeout: 5s)

**Level 3 (In Progress)**: Queue-based async processing with BullMQ + Redis

**IMPORTANT**: The complete Level 3 specification and implementation plan is located at **`docs/level3/LEVEL_3_COMPLETE_PLAN.md`**. This document contains the full, detailed plan with all milestones (0-10).

For easier learning and progressive implementation, the complete plan has been split into two simpler documents:

**Document 1 - MVP Plan** (for frontend developers new to backend):
- Start here: `docs/level3/LEVEL_3_MVP_PLAN.md`
- **Milestones 0-6**: Core async booking flow (extracted from complete plan)
- Goal: Get async booking working end-to-end with <100ms response
- Timeline: 1 week

**Document 2 - Production Hardening** (operations & monitoring):
- After MVP: `docs/level3/LEVEL_3_PRODUCTION_PLAN.md`
- **Milestones 7-10**: Rate limiting, circuit breaker, dashboard (extracted from complete plan)
- Goal: Make system production-ready for 10K+ concurrent users
- Timeline: 1 week

**Recommendation**: 
- Begin with MVP plan if you're new to backend systems
- See the complete plan (`LEVEL_3_COMPLETE_PLAN.md`) for the full architecture context
- The split approach helps you focus on core concepts before adding production complexity

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

Located in `packages/database/src/db.ts` - **Never change without understanding impact**:

The dual-mode environment system automatically handles secrets for you. However, if you need to manually manage secrets for any reason:

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

### Quick Start (New! - Zero Manual Configuration)

**TicketHive now supports automated setup with dual-mode environment management.**

```bash
1. Clone & Install
   git clone <repository-url>
   cd tickets-hive
   npm install

2. Setup Environment (automatically creates secrets)
   npm run setup  # Creates secrets/ with secure random values

3. Choose Development Mode

   Option A: Docker Development (Recommended - Production-like)
   npm run docker:dev  # Uses Docker secrets + containerized PostgreSQL

   Option B: Local Development (Fast - No Docker needed)
   npm run dev  # Uses .env.local with direct values

4. Verify Setup
   # Test API endpoints manually or use your preferred testing method

✨ That's it! No manual secret creation required.
```

### Available Scripts

**Environment Management:**
```bash
npm run setup          # Auto-generate secure secrets in secrets/
npm run docker:dev     # Setup + start Docker services
npm run docker:stop    # Stop all services
npm run docker:logs    # View logs from all services
npm run docker:clean   # Stop + remove volumes (reset database)
npm run dev            # Local development (no Docker)
```

**Development & Testing:**
```bash
npm run build          # Type-check all packages with TypeScript
npm run api:dev        # Start API server only (file watching)
```

**Docker Operations:**
```bash
# Legacy commands still work
docker compose up -d   # Start all services (if you already have secrets)
docker compose logs -f # View logs
docker compose down    # Stop services
docker compose down -v # Stop and remove volumes
```

---

## Environment Configuration

### Dual-Mode Architecture

The project now supports **two development modes** with the same code base:

#### **1. Docker Mode (Production-Ready)**
- Uses Docker Compose orchestration
- Secrets stored in `/run/secrets/` (mounted at runtime)
- PostgreSQL runs in container
- Environment: `.env.docker`
- **Best for**: Testing production-like configurations, team collaboration

```bash
npm run setup    # Creates secrets/db_password.txt, secrets/jwt_secret.txt
npm run docker:dev
```

#### **2. Local Mode (Development)**
- Uses Node.js 20+ native `--env-file` support (no dependencies!)
- Direct environment variables in `.env.local`
- Connects to local PostgreSQL
- **Best for**: Rapid iteration, debugging, IDE integration

```bash
# Ensure PostgreSQL is running locally first
npm run dev
```

### Security Considerations

**Automatic Secret Generation:**
```bash
npm run setup
```
Creates cryptographically secure secrets:
- Database password: 32 bytes (64 hex chars)
- JWT secret: 64 bytes (128 hex chars)
- File permissions: `600` (owner read/write only)
- **Never committed** - secrets/ is in .gitignore

**Environment Validation:**
All environments validated by `@t3-oss/env-core`:
- Required variables enforced at startup
- Clear error messages on missing configuration
- Type-safe environment access

### Configuration Files

**Environment Files:**
- `.env.docker` - Docker Compose configuration
- `.env.local` - Local development (direct values)
- `.env.test` - Test environment (matches generated secrets)

**Secret Files (auto-generated):**
- `secrets/db_password.txt` - PostgreSQL password
- `secrets/jwt_secret.txt` - JWT signing key

### Docker Compose Architecture

```yaml
# Full stack with secrets mounting
services:
  server:
    environment:
      POSTGRES_PASSWORD_FILE: /run/secrets/db-password
      JWT_SECRET_FILE: /run/secrets/jwt-secret
    secrets:
      - db-password
      - jwt-secret

  db:
    environment:
      POSTGRES_PASSWORD_FILE: /run/secrets/db-password
    secrets:
      - db-password

secrets:
  db-password:
    file: secrets/db_password.txt
  jwt-secret:
    file: secrets/jwt_secret.txt
```

### Migration Notes

**Legacy Setup (Still Works):**
```bash
# Manual secret creation is still supported
mkdir secrets
echo "db_password" > secrets/db_password.txt
echo "jwt_secret" > secrets/jwt_secret.txt
docker compose up -d
```

**New Setup (Recommended):**
```bash
# One-command automated setup
npm run setup      # Creates secrets for you
npm run docker:dev # Starts everything
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

**All generated code must be thoroughly commented for reader understanding**:
- Critical sections with complex logic need detailed inline comments
- Explain "why" not just "what" (especially for race condition prevention)
- Database queries should explain what data is being fetched and why
- Transaction blocks should document the rollback/commit behavior
- Error handling should explain what each error code means in context
- Complex algorithms should have step-by-step explanations
- Always comment workarounds or non-obvious solutions

**Goal**: A junior developer should understand the code by reading comments without asking questions.

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

Level 3 implementation is now split into two progressive plans for easier adoption:

### **Level 3 MVP** (`docs/level3/LEVEL_3_MVP_PLAN.md`)
For frontend developers and backend beginners - focuses on core async concepts.

**Architecture Changes**:
```
Level 2 (Current):
Client → API → Database (FOR UPDATE locks) → Response (201/409) (sync)
        └─ 800-1500ms latency, some timeouts under extreme load

Level 3 MVP (Target):
Client → API → Queue job → Response (202 Accepted) → Client
                         ↓
                      Worker → Database (optimistic locking) → SSE → Client
                         └─ <100ms latency, 0% timeouts, parallel workers
```

**MVP Components**:
- ✅ **Redis**: BullMQ job queue storage
- ✅ **BullMQ**: Queue management and job processing
- ✅ **Booking Workers**: Separate process(es) for async processing
- ✅ **Optimistic Locking**: Version column instead of `FOR UPDATE`
- ✅ **Server-Sent Events**: Real-time status updates with "fast worker" fix
- ❌ No rate limiting (for simplicity)
- ❌ No circuit breaker (Redis assumed stable in dev)

**MVP Target**: 1000 concurrent requests, <100ms API response, zero overbookings

### **Level 3 Production Hardening** (`docs/level3/LEVEL_3_PRODUCTION_PLAN.md`)
For production deployments - adds protection, monitoring, and tuning.

**Production Additions**:
- 🛡️ **Rate Limiting**: 10 req/min per user, queue depth limits
- 🛡️ **Circuit Breaker**: Fail fast on Redis failure (503 response)
- 📊 **Separate Dashboard**: Opt-in monitoring at port 3001
- 📊 **Structured Logging**: Pino for production logs
- 📊 **Metrics Collection**: Queue depth, processing time, conflict rate
- ⚡ **Configurable Everything**: Via environment variables

**Production Target**: 10,000+ concurrent users, monitoring, safe operations

**Why Server-Sent Events (SSE) over WebSockets?**
- Unidirectional communication (server → client) fits booking updates
- HTTP-based (works through proxies, firewalls)
- Simpler implementation than WebSockets
- Built-in browser support and auto-reconnection

**Choose Your Path:**
1. **New to backend?** → Start with MVP Plan (milestones 0-6)
2. **Building for production?** → Complete both MVP + Production Plan
3. **Need the full picture?** → See `docs/SPECS.md` Level 3 section

Both plans maintain the same architecture and design decisions - Production Plan simply adds operational best practices.

---

## Communication Guidelines for AI Agents

### When in Doubt, Ask!

**Critical Instruction**: If any requirement, implementation detail, or user request is unclear or ambiguous, **you MUST ask for clarification** before proceeding. This includes:

- Unclear user requirements or goals
- Ambiguous specifications or acceptance criteria
- Conflicting information between different documentation files
- Unclear priority between multiple tasks
- Questions about business logic or expected behavior
- Uncertainty about architectural decisions
- Any doubts that could lead to incorrect implementation

**Examples of when to ask**:
```
❌ DON'T: Guess what the user wants
❌ DON'T: Make assumptions about unclear requirements
❌ DON'T: Proceed with implementation when specifications conflict

✅ DO: "I see two possible approaches here. Which would you prefer?"
✅ DO: "The spec mentions X but the current implementation does Y. Should I update the implementation?"
✅ DO: "Can you clarify the expected behavior when [specific edge case] occurs?"
✅ DO: "I found conflicting information in docs/SPECS.md and the AGENTS.md. Which should I follow?"
```

**Better to ask a question than to implement the wrong solution!**

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

**5. Documentation Comments Required**
- Every service method needs Level X implementation explanation
- Document trade-offs, why specific patterns chosen
- Reference the race condition the code prevents

**6. Database First**
- Schema changes require updating `initializeDatabase()` in `packages/database/src/schema.ts`
- Test schema initialization: `docker compose down -v && docker compose up -d`
- Indexes on foreign keys for performance (user_id, event_id)

**7. Thorough Code Documentation**
- All critical sections must have detailed inline comments
- Explain "why" not just "what" (especially race conditions)
- Complex logic needs step-by-step explanations
- Goal: Junior developers understand code by reading comments

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
- ❌ **Insufficient code comments** - Critical sections need thorough explanations for reader understanding

---

## Getting Help

**Specification Source**: Always start with **`docs/SPECS.md`** - it defines all levels and requirements.

**File References**:
- Specification: `docs/SPECS.md` (defines all levels 1-4)
- Database queries: Check `packages/database/src/schema.ts` for schema and `packages/database/src/db.ts` for connection logic

**Level 3 Architecture & Implementation Plans** (IMPORTANT):
- **Complete Plan**: `docs/level3/LEVEL_3_COMPLETE_PLAN.md` contains ALL milestones 0-10 with full detail and complete architecture
- **MVP Plan (milestones 0-6)**: `docs/level3/LEVEL_3_MVP_PLAN.md` - architecture details for core async booking flow
- **Production Plan (milestones 7-10)**: `docs/level3/LEVEL_3_PRODUCTION_PLAN.md` - architecture details for rate limiting, circuit breaker, monitoring

**Note**: The MVP and Production plans are extracted subsets of the complete plan, split for easier learning. For full architectural context, always refer to the **complete plan** (`LEVEL_3_COMPLETE_PLAN.md`).

**Error handling flow**: See `packages/lib/src/errors.ts` for all error codes and `packages/lib/src/errorHandler.ts` for HTTP formatting.

**Booking logic**: Core implementation in `apps/api/src/services/bookingService.ts` with extensive comments explaining transaction flow.

---

*This guide should give you complete context for working effectively on the TicketHive project. When in doubt, check the detailed comments in source files—every critical section is extensively documented.*

---
