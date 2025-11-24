# TicketHive - High-Concurrency Event Booking System

A production-ready backend system demonstrating how to handle high-concurrency scenarios like flash sales (e.g., Taylor Swift tickets) where thousands of users compete for limited inventory.

## 🎯 Project Goals

Build a system that can handle the "Taylor Swift ticket release" scenario:
- ✅ **1000 concurrent users** trying to book tickets simultaneously
- ✅ **100 available tickets** (limited inventory)
- ✅ **Zero overbookings** (data integrity is non-negotiable)
- ✅ **Predictable behavior** under extreme load

## 🛠️ Tech Stack

- **Runtime**: Node.js with TypeScript
- **Framework**: Express.js
- **Database**: PostgreSQL (ACID compliance is critical)
- **Library**: postgres.js (lightweight, modern)
- **Authentication**: JWT
- **Containerization**: Docker & Docker Compose

---

## 📚 Implementation Levels

This project implements multiple approaches to handling concurrency, each building on the previous:

### Level 1: Naive CRUD Implementation ❌
**Status**: Demonstrates the race condition problem

Simple implementation without any concurrency control:
- Basic REST API endpoints
- Direct database operations
- **Problem**: Race conditions cause overbookings

**Load Test Results (Level 1)**:
```
Total Requests: 1000
Expected Bookings: 100
Actual Bookings: 141 ❌ (41 overbookings!)
Available Tickets: -41 ❌ (negative!)
Race Condition: DETECTED
```

### Level 2: Transaction-Based Concurrency Control ✅
**Status**: Implemented (Current)

Uses PostgreSQL transactions with pessimistic locking (FOR UPDATE):
- Row-level locks prevent concurrent modifications
- ACID guarantees ensure data integrity
- **Result**: Zero overbookings, 100% accurate

**Load Test Results (Level 2)**:
```
Total Requests: 1000
Expected Bookings: 100
Actual Bookings: 100 ✅ (perfect!)
Available Tickets: 0 ✅
Race Condition: NONE
Success Rate: 98% (bookings + sold out)
Timeout Rate: ~1-2% (acceptable)
```

---

## 🚀 Getting Started

### Prerequisites

- Docker and Docker Compose installed
- Node.js 18+ (for development)
- Git

### Quick Start

1. **Clone the repository**:
   ```bash
   git clone <repository-url>
   cd tickets-hive
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Start the services**:
   ```bash
   docker compose up -d
   ```

4. **Run the load test**:
   ```bash
   npm run load-test
   ```

### Environment Variables

The project uses Docker secrets for sensitive data. Configuration is in `docker-compose.yml`:

```yaml
POSTGRES_HOST: db
POSTGRES_PORT: 5432
POSTGRES_DB: tickethive
POSTGRES_USER: tickethive_user
POSTGRES_PASSWORD_FILE: /run/secrets/db_password
JWT_SECRET_FILE: /run/secrets/jwt_secret
```

---

## 📖 Level 2: Transaction-Based Concurrency Control (Detailed)

### Overview

Level 2 solves the race condition problem using PostgreSQL's built-in transaction and locking mechanisms. This ensures **100% data integrity** even under extreme concurrent load.

### How It Works

#### Transaction Flow for Booking

```
1. BEGIN TRANSACTION
2. SELECT * FROM events WHERE id = ? FOR UPDATE  ← Locks the row
3. Check if available_tickets > 0
4. UPDATE events SET available_tickets = available_tickets - 1
5. INSERT INTO bookings (...)
6. COMMIT (or ROLLBACK on error)
```

**Key Component: FOR UPDATE**

The `FOR UPDATE` clause creates a **pessimistic lock**:
- Other transactions trying to book the same event must **wait**
- Prevents multiple transactions from reading the same `available_tickets` value
- Lock is released when transaction commits or rolls back

#### Example Without FOR UPDATE (Race Condition)

```
Time  Transaction A           Transaction B
─────────────────────────────────────────────────
T1    SELECT available: 1
T2                            SELECT available: 1  ← Both see 1 ticket!
T3    UPDATE (decrement)
T4                            UPDATE (decrement)   ← Both decrement!
T5    INSERT booking
T6                            INSERT booking
─────────────────────────────────────────────────
Result: 2 bookings, -1 tickets  ❌ OVERBOOKING
```

#### Example With FOR UPDATE (No Race Condition)

```
Time  Transaction A           Transaction B
─────────────────────────────────────────────────
T1    SELECT ... FOR UPDATE   ← Acquires lock
T2                            SELECT ... FOR UPDATE  ← WAITS for lock
T3    Check: tickets = 1
T4    UPDATE (decrement)
T5    INSERT booking
T6    COMMIT                  ← Releases lock
T7                            Now proceeds...
T8                            Check: tickets = 0
T9                            SOLD OUT error
─────────────────────────────────────────────────
Result: 1 booking, 0 tickets  ✅ CORRECT
```

### Configuration

#### Database Connection Pool (`src/lib/db.ts`)

```typescript
const sql = postgres({
  max: 20,                    // Connection pool size
  idle_timeout: 30,           // Seconds before closing idle connections
  connect_timeout: 10,        // Seconds to wait for initial connection
  connection: {
    statement_timeout: 5000,  // Milliseconds for query timeout
  },
});
```

**Why These Values?**

- **max: 20 connections**: Tested with 1000 concurrent requests. Balances throughput with database load.
- **statement_timeout: 5000ms (5 seconds)**: Prevents indefinite waits. If a transaction holds a lock for >5s, PostgreSQL terminates it.
  - Normal booking: <100ms
  - Under high contention: 100-500ms
  - Extreme contention: Times out after 5s (prevents cascading delays)

### Performance Characteristics

| Metric | Level 1 (Naive) | Level 2 (Transactional) |
|--------|-----------------|-------------------------|
| **Data Integrity** | ❌ 41% overbooking | ✅ 100% accurate |
| **Race Conditions** | ❌ Detected | ✅ Eliminated |
| **Booking Success Rate** | ~14% | ~10% (correct!) |
| **Sold Out Responses** | N/A | ~88% (expected!) |
| **Timeout Rate** | 0% | ~1-2% (acceptable) |
| **Avg Response Time** | 455ms | ~800-1500ms |
| **Throughput** | 2,198 req/s | ~200-333 req/s |
| **Negative Tickets** | ❌ Yes (-41) | ✅ Never |

### Trade-offs

#### ✅ Pros
- **100% data integrity** - No overbooking, ever
- **ACID compliance** - Atomic operations
- **Simple to implement** - Uses built-in database features
- **Easy to reason about** - Transactional logic is well-understood
- **Works within single database** - No distributed coordination needed

#### ⚠️ Cons
- **Lower throughput** - Requests serialize on locked rows
- **Higher latency** - Transactions must wait for locks
- **Timeout errors** - Some requests timeout under extreme load (acceptable)
- **Database is the bottleneck** - Can't scale horizontally (yet)

**When Level 2 is Perfect:**
- Single database instance
- Moderate to high traffic (not millions of requests/second)
- Data integrity is more important than throughput
- Acceptable to have some users retry

**When to Move to Level 3:**
- Timeout rate >20%
- Need to handle 10,000+ concurrent requests
- Want async processing with immediate response

---

## 🔐 Error Handling Architecture

### Error Categories

Understanding the difference between business logic and infrastructure errors is crucial for proper error handling, user experience, and system monitoring.

#### Business Logic Errors (4xx - Client Errors)

**EXPECTED errors** caused by invalid user requests or business rule violations:

| Error Code | Status | Meaning | User Action |
|------------|--------|---------|-------------|
| `EVENT_NOT_FOUND` | 404 | Event doesn't exist | Check event ID |
| `EVENT_SOLD_OUT` | 409 | No tickets available | Try different event |
| `BOOKING_ALREADY_CANCELLED` | 409 | Already cancelled | Don't retry |
| `INVALID_CREDENTIALS` | 401 | Wrong email/password | Check credentials |
| `EMAIL_ALREADY_REGISTERED` | 409 | Email taken | Use different email |

**Characteristics**:
- Part of **normal operation**
- Should **NOT** trigger alerts
- User can fix by changing their request
- Should **NOT** be retried (same request will fail again)

#### Infrastructure Errors (5xx - Server Errors)

**EXCEPTIONAL errors** indicating system problems:

| Error Code | Status | Meaning | User Action |
|------------|--------|---------|-------------|
| `STATEMENT_TIMEOUT` | 503 | Database overloaded | Wait and retry |
| `DATABASE_CONNECTION_ERROR` | 503 | Can't reach database | Wait and retry |
| `INTERNAL_SERVER_ERROR` | 500 | Unexpected bug | Report issue |

**Characteristics**:
- Should be **RARE**
- **Should trigger alerts**
- Not the user's fault
- **CAN be retried** (may succeed on retry)
- May indicate need for scaling/optimization

### Technical vs User-Friendly Error Messages

A key principle: **Never expose technical error details to end users.**

#### Example 1: Statement Timeout

**❌ Technical (Raw PostgreSQL error)**:
```
PostgresError: canceling statement due to statement timeout
    at Parser.parseErrorMessage (/node_modules/postgres/src/connection.js:791:15)
    at Parser.parseMessage (/node_modules/postgres/src/connection.js:654:17)
code: '57014'
position: undefined
routine: 'ProcessInterrupts'
```

**✅ User-Friendly (Our API response)**:
```json
{
  "success": false,
  "error": {
    "code": "STATEMENT_TIMEOUT",
    "message": "High traffic detected. Please try again in a moment."
  }
}
```

#### Example 2: Event Not Found

**❌ Technical**:
```
Error: No rows returned from query: SELECT * FROM events WHERE id = '123e4567-e89b...'
    at EventService.getEventById (src/services/eventService.ts:45:11)
```

**✅ User-Friendly**:
```json
{
  "success": false,
  "error": {
    "code": "EVENT_NOT_FOUND",
    "message": "Event not found"
  }
}
```

#### Why User-Friendly Messages Are Better

- ✅ No scary technical jargon
- ✅ Tells user what to do next
- ✅ Doesn't expose system internals (security)
- ✅ Consistent format across all errors
- ✅ Easy to translate to other languages
- ✅ Professional appearance
- ✅ Beginner-friendly language

### Three-Layer Error Handling

Our architecture separates concerns across three layers:

#### 1. Database Layer (PostgreSQL)
- Throws low-level errors (code `57014`, `23505`, etc.)
- Technical messages for developers
- Example: `"canceling statement due to statement timeout"`

#### 2. Service Layer (`src/services/`)
- Catches database errors
- Converts to `AppError` with business-friendly codes
- Example: PostgreSQL `57014` → let it propagate for route to handle
- See: `src/services/bookingService.ts`

#### 3. Route Layer (`src/routes/`)
- Catches `AppError` and database errors
- Formats as HTTP responses with user-friendly messages
- Maps to appropriate status codes (404, 409, 503, etc.)
- See: `src/routes/bookings.ts`

**Example Flow**:
```
Database:  PostgresError (code: 57014)
    ↓
Service:   Let it propagate (infrastructure error)
    ↓
Route:     { code: "STATEMENT_TIMEOUT", message: "High traffic..." }
    ↓
Client:    503 Service Unavailable with friendly message
```

---

## 🔄 Client Retry Strategy (Exponential Backoff)

When your client (web/mobile app) receives a **503 timeout error**, implement this retry pattern:

### Why Exponential Backoff?

If 1000 users all get timeout errors and immediately retry:
- Still 1000 concurrent requests! ❌
- Problem not solved

With exponential backoff:
- Retries spread over time ✅
- Reduces load on system ✅
- Increases chance of success ✅

### Implementation Example

```javascript
async function bookTicket(eventId, maxRetries = 4) {
  let attempt = 0;
  
  while (attempt < maxRetries) {
    try {
      const response = await fetch('/api/v1/bookings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ eventId })
      });
      
      if (response.ok) {
        return await response.json(); // ✅ Success!
      }
      
      if (response.status === 503) {
        // Timeout - retry with exponential backoff
        attempt++;
        const waitTime = Math.pow(2, attempt) * 1000; // 1s, 2s, 4s, 8s
        console.log(`Retrying in ${waitTime}ms...`);
        await sleep(waitTime);
        continue;
      }
      
      if (response.status === 409) {
        // Sold out - don't retry
        throw new Error('Event sold out');
      }
      
      // Other errors (404, 400) - don't retry
      throw new Error('Booking failed');
      
    } catch (error) {
      if (attempt >= maxRetries - 1) throw error;
    }
  }
  
  throw new Error('Max retries exceeded');
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
```

### Retry Strategy by Error Type

| Error | Status | Retry? | Strategy |
|-------|--------|--------|----------|
| Timeout | 503 | ✅ Yes | Exponential backoff (1s, 2s, 4s, 8s) |
| Connection Error | 503 | ✅ Yes | Exponential backoff |
| Sold Out | 409 | ❌ No | Show "sold out" message |
| Not Found | 404 | ❌ No | Show error message |
| Invalid Request | 400 | ❌ No | Fix request format |

---

## 📊 Load Testing

### Running Load Tests

```bash
# Make sure services are running
docker compose up -d

# Run the load test (1000 concurrent requests)
npm run load-test
```

### Expected Results (Level 2)

```
======================================================================
📊 LOAD TEST RESULTS - Level 2 (Transaction + Timeout Handling)
======================================================================

📈 Request Metrics:
  Total Requests: 1000
  Successful Bookings (201): 100 (10.0%)     ✅ Exactly as expected
  Sold Out (409): 880-890 (88-89%)           ✅ Expected behavior
  Timeouts (503): 10-20 (1-2%)               ⚠️  Acceptable under load
  HTTP Success Rate: 98%                     ✅ Great!

⏱️  Performance Metrics:
  Duration: ~3000-5000ms
  Avg Response Time: 800-1500ms
  Throughput: ~200-333 requests/sec

🎟️  Data Integrity:
  Expected Bookings: 100
  Actual Bookings: 100    ✅ Perfect match
  Available Tickets: 0    ✅ No negative numbers

✅ Race Condition Analysis:
  🟢 RACE CONDITION: NONE ✅
     - Exact match: 100 == 100
     - No negative tickets: 0 >= 0
     - Transactions working correctly!

💡 Level 2 Key Insights:
   ✅ 10% booking rate is CORRECT (100 tickets / 1000 requests)
   ✅ 88% sold out responses are EXPECTED behavior
   ⚠️  2% timeout rate is acceptable under extreme load
   📊 Zero overbookings = Data integrity maintained!
======================================================================
```

### Understanding the Results

**Q: Why is the booking success rate only 10%?**

A: Because we have 100 tickets and 1000 requests!
- 100 successful bookings / 1000 requests = 10% ✅
- This is **mathematically correct**
- The other 90% get "sold out" or timeout responses

**Q: Aren't 88% "sold out" responses bad?**

A: No! This is **expected and correct** behavior:
- After 100 bookings, the remaining ~900 requests should fail
- They fail with 409 "EVENT_SOLD_OUT" (business logic, not a bug)
- This is much better than overbooking!

**Q: What about the timeout errors?**

A: 1-2% timeout rate is acceptable:
- Caused by extreme lock contention (1000 simultaneous requests)
- Prevents indefinite waits (better to timeout than wait forever)
- Users can retry and likely succeed
- If >20% timeout rate, consider Level 3 (queues)

---

## 🔧 Troubleshooting

### Too Many Timeout Errors

**Symptom**: >20% of requests return 503 timeout errors

**Solutions**:
1. Increase `statement_timeout` in `src/lib/db.ts`:
   ```typescript
   statement_timeout: 10000  // 10 seconds instead of 5
   ```
2. Increase connection pool size:
   ```typescript
   max: 30  // 30 connections instead of 20
   ```
3. Consider moving to Level 3 (queues) for async processing

### Connection Pool Exhausted

**Symptom**: Errors like "Connection terminated unexpectedly"

**Solutions**:
1. Increase `max` connections in `src/lib/db.ts`
2. Check PostgreSQL `max_connections` setting (default: 100)
3. Look for connection leaks (transactions not completing)

### Slow Response Times

**Symptom**: Average response time >2 seconds

**Expected**: This is normal under high contention with Level 2
- Requests serialize on locked rows
- Some requests wait for others to complete
- Trade-off: Data integrity vs throughput

**If Unacceptable**: Implement Level 3 with BullMQ queues for async processing

### Database Connection Issues

**Symptom**: Can't connect to database on startup

**Check**:
1. Docker containers running: `docker compose ps`
2. Database logs: `docker compose logs db`
3. Password file exists: `docker compose exec api cat /run/secrets/db_password`
4. Network connectivity: `docker compose exec api ping db`

---

## 🏗️ Architecture

### Project Structure

```
tickets-hive/
├── src/
│   ├── index.ts              # Express app setup
│   ├── lib/
│   │   ├── db.ts             # PostgreSQL connection config
│   │   ├── env.ts            # Environment variables
│   │   └── errors.ts         # Error handling system
│   ├── middleware/
│   │   └── verify-token.ts   # JWT authentication
│   ├── routes/
│   │   ├── auth.ts           # Login/register
│   │   ├── bookings.ts       # Booking endpoints
│   │   └── events.ts         # Event endpoints
│   ├── services/
│   │   ├── authService.ts    # Auth business logic
│   │   ├── bookingService.ts # Booking transactions
│   │   └── eventService.ts   # Event management
│   └── types/
│       └── index.ts          # TypeScript types
├── tests/
│   └── load-test.ts          # Concurrency test
├── docker-compose.yml        # Services orchestration
├── Dockerfile                # API container
└── README.md                 # This file
```

### Database Schema

```sql
-- Users
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  name VARCHAR(255) NOT NULL,
  role user_role DEFAULT 'user',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Events
CREATE TABLE events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  total_tickets INT NOT NULL,
  available_tickets INT NOT NULL,
  event_date TIMESTAMP NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Bookings
CREATE TABLE bookings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  status booking_status NOT NULL DEFAULT 'CONFIRMED',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

### API Endpoints

#### Authentication
- `POST /auth/register` - Register new user
- `POST /auth/login` - Login (returns JWT)

#### Events
- `POST /api/v1/events` - Create event (admin only)
- `GET /api/v1/events` - List events (paginated)
- `GET /api/v1/events/:id` - Get event details

#### Bookings
- `POST /api/v1/bookings` - Create booking (authenticated)
- `GET /api/v1/bookings/:id` - Get booking details
- `DELETE /api/v1/bookings/:id` - Cancel booking

---

## 📚 Learning Outcomes

By studying this Level 2 implementation, you'll understand:

### 1. Database Transactions
- ACID properties in practice
- BEGIN/COMMIT/ROLLBACK flow
- When and why to use transactions

### 2. Pessimistic Locking
- How `FOR UPDATE` prevents race conditions
- Lock contention and performance impact
- When pessimistic locking is appropriate

### 3. Connection Pooling
- Why connection pools are necessary
- How to configure pool size
- Pool exhaustion and recovery

### 4. Timeout Strategies
- Statement timeout vs connect timeout
- Preventing indefinite waits
- Handling timeout errors gracefully

### 5. Error Taxonomy
- Business logic errors (4xx) vs infrastructure errors (5xx)
- When to retry vs when to give up
- Error handling layers (database → service → route)

### 6. User Experience
- Converting technical errors to user-friendly messages
- Example: `"canceling statement due to timeout"` → `"High traffic, please try again"`
- Why hiding technical details improves security and UX

### 7. System Trade-offs
- Data integrity vs throughput
- Latency vs correctness
- When to optimize vs when to redesign

### 8. Client-Side Patterns
- Exponential backoff retry strategy
- Distinguishing retryable from non-retryable errors
- Preventing retry storms

---

## 🚀 Next Steps: Level 3 Preview

When Level 2's timeout rate becomes unacceptable (>20%), it's time for Level 3:

### Level 3: Queue-Based Async Processing

**Changes**:
- Add **BullMQ** job queue with Redis
- API returns `202 Accepted` immediately
- Background workers process bookings asynchronously
- WebSocket/polling for status updates

**Benefits**:
- Handle 10,000+ concurrent requests
- No timeout errors (requests don't wait for processing)
- Horizontal scaling with multiple workers
- Better user experience (immediate feedback)

**Trade-offs**:
- More complex architecture
- Eventually consistent (not immediate)
- Requires additional infrastructure (Redis, workers)

---

## 📝 License

MIT

---

## 🙏 Acknowledgments

This project demonstrates production-level patterns for handling high-concurrency scenarios based on industry best practices. The implementation focuses on educational value while maintaining code quality suitable for real-world applications.

**Key Principles Demonstrated**:
- Data integrity is non-negotiable
- Fail fast with clear error messages
- Trade-offs are inevitable - choose consciously
- Document the "why" not just the "what"
- Test under realistic load conditions
