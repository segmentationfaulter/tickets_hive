# Project: "TicketHive" – High-Concurrency Event Booking System

## 1. Project Overview

**The Goal**: Build a backend system capable of handling a "flash sale" scenario (e.g., Taylor Swift tickets release) where thousands of users attempt to purchase a limited number of seats simultaneously.

**The Stack (FanKave Alignment)**:

*   **Runtime**: Node.js (TypeScript)
*   **Framework**: Express or NestJS (NestJS is recommended for structure)
*   **Database**: PostgreSQL (Relational data integrity is non-negotiable here)
*   **Caching/Queues**: Redis & BullMQ
*   **Containerization**: Docker & Docker Compose

---

## Level 1: The "Junior" Implementation (CRUD & Basic Logic)

**Goal**: Get the API working. Users can create events and book seats.

### 1.1 Database Schema (PostgreSQL)

Create a normalized schema. Avoid "JSON dumps" in columns; use relations.

**Users Table**
```sql
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) UNIQUE NOT NULL,
  name VARCHAR(255) NOT NULL
);
```

**Events Table**
```sql
CREATE TABLE events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  total_tickets INT NOT NULL,
  available_tickets INT NOT NULL
);
```

**Bookings Table**
```sql
CREATE TABLE bookings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id),
  event_id UUID REFERENCES events(id),
  status VARCHAR(50) DEFAULT 'CONFIRMED', -- CONFIRMED, CANCELLED
  created_at TIMESTAMP DEFAULT NOW()
);
```

### 1.2 API Endpoints

*   `POST /events`: Create a new event (e.g., "Coldplay Concert", 100 tickets).
*   `POST /book`: The critical endpoint.
    *   **Body**: `{ userId: "...", eventId: "..." }`
    *   **Logic**:
        1.  Find Event.
        2.  Check if `available_tickets > 0`.
        3.  Decrement `available_tickets`.
        4.  Create Booking record.
        5.  Return Success.

> ### 🛑 The Problem with Level 1
> If you run a load test (Apache JMeter or K6) sending 100 concurrent requests when only 1 ticket is left, your database will likely allow 5-10 people to book that single seat. This is the **"Race Condition."**

---

## Level 2: The "Mid-Level" Implementation (Transactions & Locking)

**Goal**: Fix the race condition using Database ACID properties.

### 2.1 The Transactional Approach

Refactor the `POST /book` logic to use a Database Transaction.

**Logic Change**:
```typescript
await db.transaction(async (trx) => {
    // LOCK the row so no one else can read it until I'm done
    const event = await trx('events')
        .where('id', eventId)
        .forUpdate() // <--- CRITICAL: Row-level locking (Pessimistic Lock)
        .first();

    if (event.available_tickets <= 0) throw new Error('Sold Out');

    await trx('events').decrement('available_tickets', 1);
    await trx('bookings').insert({ ... });
});
```

> ### 🛑 The Problem with Level 2
> `FOR UPDATE` locks the database row. If 10,000 users hit this endpoint, the database requests line up one by one. The API becomes incredibly slow (high latency). The database becomes the bottleneck.

---

## Level 3: The "Senior" Implementation (Queues & Distributed Systems)

**Goal**: Handle high throughput without crashing the DB. Decouple the "Request" from the "Processing."

### 3.1 Architecture Shift

Instead of writing to Postgres immediately, the API pushes a "job" to a Queue.

1.  User hits `POST /book`.
2.  API validates request structure -> Pushes job to Redis (BullMQ) -> Returns `"202 Accepted"` (Booking Pending).
3.  Worker Service (separate Node process) pulls job from Redis -> Process DB transaction.
4.  Socket/Polling: User listens for a WebSocket event `"BookingConfirmed"`.

### 3.2 Handling Concurrency in the Worker

Even with a queue, if you have 5 workers running in parallel, you still have race conditions.

**Solution**: Use **Optimistic Concurrency Control (Versioning)**.

**Schema Change**: Add a `version` column to the `events` table.

**Logic**:
```sql
UPDATE events
SET available_tickets = available_tickets - 1, version = version + 1
WHERE id = $1 AND version = $2; -- Check if version matches what we read
```

If the update affects 0 rows, it means someone else modified the record in the split second between read and write. The worker should retry or fail.

---

## Level 4: The "Principal" Polish (Resilience & Safety)

**Goal**: Make the system bulletproof.

### 4.1 Idempotency (The Interview Winner)

What if the user clicks "Book" twice? What if the network fails after the API receives the request but before the response reaches the client?

*   **Requirement**: Client sends a unique `Idempotency-Key` header (e.g., a UUID generated on the frontend).
*   **Implementation**: Store this Key in Redis with a TTL (Time To Live). If a request comes with a known Key, return the previous result immediately without processing the queue again.

### 4.2 Distributed Locking (Redlock)

For extreme precision (e.g., specific seat selection like "Row A, Seat 1"), Optimistic locking isn't enough.

*   Use Redis to create a temporary lock on a specific resource ID (`lock:event:123:seat:A1`).
*   If the lock exists, reject the request immediately before touching the database.

---

## Technical Requirements Checklist (for your GitHub)

### 1. The Code Structure

Organize as a Monorepo (using Turborepo or simple folder structure):

```
/apps
  /api       (Express/NestJS - handles HTTP requests)
  /worker    (Node.js - processes BullMQ jobs)
/packages
  /database  (Shared Prisma/TypeORM client)
  /types     (Shared TS interfaces)
```

### 2. Load Testing Script (Proof of Competence)

You must include a script that proves your system works.

*   Create a script `load-test.ts`.
*   It spawns 1000 promises.
*   Each promise hits `POST /book`.
*   **Expected Output**: `"Sold 100 tickets. Rejected 900 requests. Database integrity: 100% match."`

### 3. Docker Compose

Your `docker-compose.yml` must spin up:
*   Postgres
*   Redis
*   API Service
*   Worker Service

---

## Suggested Development Timeline

*   **Day 1-2**: Set up NestJS, Postgres, and Docker. Build Level 1 (Naive CRUD).
*   **Day 3**: Write a test script that breaks your Level 1 code (overselling tickets).
*   **Day 4-5**: Implement BullMQ. Move the booking logic into a Worker Processor.
*   **Day 6**: Implement Optimistic Locking (Versioning) or Redlock.
*   **Day 7**: Add the Load Test script to the README and record a loom video showing it handling 1k requests per second.
