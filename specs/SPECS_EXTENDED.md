# TicketHive – High-Concurrency Event Booking System
**Senior Backend Engineering Showcase Project**

---

## 🎯 Project Goals

Build a production-grade backend system capable of handling flash-sale scenarios (e.g., concert ticket releases) where thousands of users compete for limited inventory. Demonstrate expertise in:
- Concurrency control & race condition prevention
- Distributed systems architecture (queues, caching, locking)
- Database optimization & transaction management
- Production engineering (observability, testing, security)
- System scalability & resilience

---

## 🛠️ Tech Stack

- **Runtime:** Bun 1.1+ (fast JavaScript runtime with built-in tooling)
- **Language:** TypeScript 5+
- **Framework:** Express.js 4.x
- **Database:** PostgreSQL 15+ with **Raw SQL** (using `postgres` or `pg` library)
- **Migrations:** Custom SQL migration files (simple, transparent)
- **Queue:** BullMQ (Redis-backed task queue)
- **Caching:** Redis 7+ with `ioredis`
- **WebSockets:** `ws` or `socket.io`
- **Infrastructure:** Docker + Docker Compose
- **Testing:** Bun's built-in test runner
- **Validation:** Zod (TypeScript-first schema validation)
- **Logging:** Pino (high-performance logging)

### Why Raw SQL Instead of Prisma?
- **Simplicity:** No code generation, no ORM abstraction layer
- **Control:** Full visibility into queries, easier to optimize
- **Performance:** No ORM overhead, direct database access
- **Senior-level skill:** Shows deep SQL knowledge, not just ORM usage
- **Debugging:** Easier to troubleshoot—you write the exact queries
- **Aligns with your resume:** Your Go projects use raw SQL (consistent approach)

---

## 📐 System Architecture

```
┌─────────────┐      ┌──────────────┐      ┌─────────────┐
│   Client    │─────▶│   API Server │─────▶│   Redis     │
│  (Load Test)│      │  (REST/WS)   │      │  (Queue)    │
└─────────────┘      └──────────────┘      └─────────────┘
                            │                      │
                            ▼                      ▼
                     ┌──────────────┐      ┌─────────────┐
                     │  PostgreSQL  │◀─────│   Worker    │
                     │  (Raw SQL)   │      │  (Consumer) │
                     └──────────────┘      └─────────────┘
```

---

## 🗄️ Database Schema

### Migration Files Structure
```
migrations/
├── 001_create_users.sql
├── 002_create_events.sql
├── 003_create_bookings.sql
├── 004_create_booking_events.sql
└── 005_add_indexes.sql
```

### SQL Schema Files

**001_create_users.sql**
```sql
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) UNIQUE NOT NULL,
  name VARCHAR(255) NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);
```

**002_create_events.sql**
```sql
CREATE TABLE IF NOT EXISTS events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  total_tickets INT NOT NULL,
  available_tickets INT NOT NULL CHECK (available_tickets >= 0),
  price_cents INT NOT NULL,
  event_date TIMESTAMP NOT NULL,
  version INT DEFAULT 1,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

**003_create_bookings.sql**
```sql
CREATE TABLE IF NOT EXISTS bookings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  status VARCHAR(20) NOT NULL CHECK (status IN ('PENDING', 'RESERVED', 'CONFIRMED', 'FAILED', 'CANCELLED')),
  idempotency_key VARCHAR(255) UNIQUE,
  expires_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

**004_create_booking_events.sql**
```sql
CREATE TABLE IF NOT EXISTS booking_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  event_type VARCHAR(50) NOT NULL,
  payload JSONB,
  created_at TIMESTAMP DEFAULT NOW()
);
```

**005_add_indexes.sql**
```sql
CREATE INDEX IF NOT EXISTS idx_bookings_user_id ON bookings(user_id);
CREATE INDEX IF NOT EXISTS idx_bookings_event_id ON bookings(event_id);
CREATE INDEX IF NOT EXISTS idx_bookings_status ON bookings(status);
CREATE INDEX IF NOT EXISTS idx_bookings_idempotency_key ON bookings(idempotency_key);
CREATE INDEX IF NOT EXISTS idx_events_event_date ON events(event_date);
CREATE INDEX IF NOT EXISTS idx_booking_events_booking_id ON booking_events(booking_id);
```

---

## 🔌 API Endpoints

### Core Endpoints
```
POST   /api/v1/events              Create event (admin)
GET    /api/v1/events              List events (paginated)
GET    /api/v1/events/:id          Get event details

POST   /api/v1/bookings            Initiate booking
GET    /api/v1/bookings/:id        Get booking status
DELETE /api/v1/bookings/:id        Cancel booking

WS     /ws                         WebSocket for real-time status
```

### Operational Endpoints
```
GET    /health                     Health check
GET    /ready                      Readiness check
GET    /metrics                    Prometheus metrics
```

### Request/Response Examples

**POST /api/v1/bookings**
```json
// Request Headers
{
  "Idempotency-Key": "uuid-from-client",
  "Content-Type": "application/json"
}

// Request Body
{
  "userId": "uuid",
  "eventId": "uuid"
}

// Response (202 Accepted)
{
  "bookingId": "uuid",
  "status": "PENDING",
  "message": "Booking queued for processing",
  "_links": {
    "status": "/api/v1/bookings/{bookingId}"
  }
}
```

---

## 🏗️ Implementation Roadmap

### Phase 1: MVP (Basic CRUD)
**Goal:** Get the API working with basic booking logic.

**Tasks:**
- [ ] Set up project structure with Docker Compose
- [ ] Implement database schema with migrations
- [ ] Create REST endpoints for events and bookings
- [ ] Basic booking logic: Check availability → Decrement → Confirm

**Expected Issue:** Race conditions causing oversold tickets.

---

### Phase 2: Transaction Safety
**Goal:** Fix race conditions using database ACID properties.

**Tasks:**
- [ ] Wrap booking logic in database transactions
- [ ] Implement row-level locking (`SELECT ... FOR UPDATE`)
- [ ] Add basic error handling and retries

**Expected Issue:** High latency under concurrent load (lock contention).

---

### Phase 3: Queue-Based Architecture
**Goal:** Decouple request handling from processing for scalability.

**Tasks:**
- [ ] Integrate Redis + Asynq/BullMQ
- [ ] API returns 202 Accepted, pushes job to queue
- [ ] Worker service processes jobs asynchronously
- [ ] Implement optimistic concurrency control (version column)
- [ ] Add WebSocket for real-time status updates

**Key Pattern:**
```
1. API validates request
2. Check Redis for duplicate (idempotency key)
3. Push job to queue
4. Return 202 Accepted
5. Worker pulls job → DB transaction → Emit status via WebSocket
```

---

### Phase 4: Production Hardening
**Goal:** Add observability, resilience, and security.

**Tasks:**
- [ ] **Observability:**
  - Structured logging (JSON format)
  - Prometheus metrics (booking rate, queue depth, error rate)
  - Distributed tracing (OpenTelemetry)
- [ ] **Resilience:**
  - Idempotency (Redis cache for duplicate requests)
  - Circuit breaker for external dependencies
  - Graceful degradation (fallback to sync processing if Redis is down)
  - Ticket reservation expiry (auto-release after 10 minutes)
- [ ] **Security:**
  - Rate limiting (per-user and per-IP)
  - Input validation (DTOs)
  - SQL injection prevention (parameterized queries)
- [ ] **Testing:**
  - Unit tests (business logic)
  - Integration tests (database transactions)
  - E2E tests (full booking flow)
  - Load tests (prove 100 tickets = 100 bookings)

---

### Phase 5: Advanced Features (Optional)
- [ ] **Payment Integration:** Mock 2-phase commit with payment provider
- [ ] **Distributed Locking:** Redis-based locking for seat selection
- [ ] **Seat Selection:** Users choose specific seats (requires inventory management)
- [ ] **Waitlist:** Queue users when sold out
- [ ] **Admin Dashboard:** Real-time booking statistics
- [ ] **CI/CD Pipeline:** GitHub Actions for testing and deployment

---

## 🧪 Load Testing Requirements

### Test Scenario
**Objective:** Prove system correctness under high concurrency.

**Setup:**
- Create event with 100 tickets
- Simulate 1,000 concurrent users attempting to book
- Each user retries up to 3 times on failure

**Success Criteria:**
1. **Exactly 100 bookings confirmed** (no overselling)
2. **900 requests rejected** (graceful failure)
3. **No database deadlocks** (monitor logs)
4. **Average response time < 500ms** (p95 < 1s)
5. **Zero duplicate bookings** (idempotency working)

### Load Test Script (Pseudocode)
```javascript
// Using k6, Artillery, or custom script
for (let i = 0; i < 1000; i++) {
  const idempotencyKey = generateUUID();
  
  http.post('/api/v1/bookings', {
    headers: { 'Idempotency-Key': idempotencyKey },
    body: { userId: `user-${i}`, eventId: 'concert-123' }
  });
}

// Assert: COUNT(*) FROM bookings WHERE event_id = 'concert-123' = 100
```

**Include in README:**
- Screenshot of load test output
- Database query proving ticket count
- Grafana dashboard (optional but impressive)

---

## 💻 Code Examples

### Basic Express Server Setup

```typescript
// src/server.ts
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { errorHandler } from './middleware/errorHandler';
import { requestLogger } from './middleware/logger';
import { rateLimiter } from './middleware/rateLimiter';
import eventRoutes from './routes/events';
import bookingRoutes from './routes/bookings';
import healthRoutes from './routes/health';

const app = express();

// Middleware
app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(requestLogger);

// Routes
app.use('/api/v1/events', rateLimiter, eventRoutes);
app.use('/api/v1/bookings', rateLimiter, bookingRoutes);
app.use('/', healthRoutes);

// Error handling
app.use(errorHandler);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`API server running on port ${PORT}`);
});
```

### Booking Route with Validation

```typescript
// src/routes/bookings.ts
import { Router } from 'express';
import { z } from 'zod';
import { validateRequest } from '../middleware/validator';
import { bookingController } from '../controllers/bookingController';

const router = Router();

const createBookingSchema = z.object({
  body: z.object({
    userId: z.string().uuid(),
    eventId: z.string().uuid(),
  }),
  headers: z.object({
    'idempotency-key': z.string().uuid(),
  }).passthrough(),
});

router.post(
  '/',
  validateRequest(createBookingSchema),
  bookingController.createBooking
);

router.get('/:id', bookingController.getBooking);
router.delete('/:id', bookingController.cancelBooking);

export default router;
```

### Booking Service (Core Logic)

```typescript
// src/services/bookingService.ts
import { Queue } from 'bullmq';
import { db } from '../lib/db';
import { redis } from '../lib/redis';
import { logger } from '../lib/logger';

const bookingQueue = new Queue('bookings', { connection: redis });

export class BookingService {
  async queueBooking(
    userId: string,
    eventId: string,
    idempotencyKey: string
  ) {
    // Check idempotency
    const cached = await redis.get(`idempotency:${idempotencyKey}`);
    if (cached) {
      return JSON.parse(cached);
    }

    // Create pending booking
    const result = await db.query(
      `INSERT INTO bookings (user_id, event_id, status, idempotency_key)
       VALUES ($1, $2, $3, $4)
       RETURNING id, user_id, event_id, status, created_at`,
      [userId, eventId, 'PENDING', idempotencyKey]
    );

    const booking = result.rows[0];

    // Add to queue
    await bookingQueue.add('process-booking', {
      bookingId: booking.id,
      userId,
      eventId,
    });

    // Cache response
    const response = {
      bookingId: booking.id,
      status: 'PENDING',
      _links: {
        status: `/api/v1/bookings/${booking.id}`,
      },
    };
    
    await redis.setex(
      `idempotency:${idempotencyKey}`,
      3600,
      JSON.stringify(response)
    );

    return response;
  }

  async processBooking(bookingId: string, eventId: string) {
    const client = await db.getClient();
    
    try {
      await client.query('BEGIN');

      // Lock event row and get current state
      const eventResult = await client.query(
        `SELECT id, available_tickets, version 
         FROM events 
         WHERE id = $1 
         FOR UPDATE`,
        [eventId]
      );

      const event = eventResult.rows[0];

      if (!event || event.available_tickets <= 0) {
        await client.query(
          `UPDATE bookings 
           SET status = $1, updated_at = NOW() 
           WHERE id = $2`,
          ['FAILED', bookingId]
        );
        
        await client.query('COMMIT');
        throw new Error('No tickets available');
      }

      // Optimistic locking: decrement with version check
      const updateResult = await client.query(
        `UPDATE events 
         SET available_tickets = available_tickets - 1,
             version = version + 1,
             updated_at = NOW()
         WHERE id = $1 
           AND version = $2 
           AND available_tickets > 0
         RETURNING id`,
        [eventId, event.version]
      );

      if (updateResult.rowCount === 0) {
        await client.query('ROLLBACK');
        throw new Error('Concurrent modification detected');
      }

      // Confirm booking
      const bookingResult = await client.query(
        `UPDATE bookings 
         SET status = $1, updated_at = NOW() 
         WHERE id = $2 
         RETURNING *`,
        ['CONFIRMED', bookingId]
      );

      const booking = bookingResult.rows[0];

      // Create audit log
      await client.query(
        `INSERT INTO booking_events (booking_id, event_type, payload)
         VALUES ($1, $2, $3)`,
        [bookingId, 'CONFIRMED', JSON.stringify({ eventId, timestamp: new Date() })]
      );

      await client.query('COMMIT');
      return booking;
      
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async getBooking(bookingId: string) {
    const result = await db.query(
      `SELECT b.*, u.name as user_name, u.email as user_email, 
              e.name as event_name, e.event_date
       FROM bookings b
       JOIN users u ON b.user_id = u.id
       JOIN events e ON b.event_id = e.id
       WHERE b.id = $1`,
      [bookingId]
    );

    return result.rows[0];
  }

  async cancelBooking(bookingId: string) {
    const client = await db.getClient();
    
    try {
      await client.query('BEGIN');

      // Get booking details
      const bookingResult = await client.query(
        `SELECT * FROM bookings WHERE id = $1 FOR UPDATE`,
        [bookingId]
      );

      const booking = bookingResult.rows[0];

      if (!booking) {
        throw new Error('Booking not found');
      }

      if (booking.status !== 'CONFIRMED') {
        throw new Error('Only confirmed bookings can be cancelled');
      }

      // Return ticket to inventory
      await client.query(
        `UPDATE events 
         SET available_tickets = available_tickets + 1,
             updated_at = NOW()
         WHERE id = $1`,
        [booking.event_id]
      );

      // Update booking status
      await client.query(
        `UPDATE bookings 
         SET status = $1, updated_at = NOW() 
         WHERE id = $2`,
        ['CANCELLED', bookingId]
      );

      // Create audit log
      await client.query(
        `INSERT INTO booking_events (booking_id, event_type, payload)
         VALUES ($1, $2, $3)`,
        [bookingId, 'CANCELLED', JSON.stringify({ timestamp: new Date() })]
      );

      await client.query('COMMIT');
      return { success: true, bookingId };
      
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}
```

### Database Connection Pool

```typescript
// src/lib/db.ts
import { Pool } from 'pg';
import { logger } from './logger';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20, // Maximum number of clients in the pool
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

pool.on('error', (err) => {
  logger.error('Unexpected error on idle client', err);
  process.exit(-1);
});

export const db = {
  query: (text: string, params?: any[]) => pool.query(text, params),
  getClient: () => pool.connect(),
};

// Graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, closing database pool');
  await pool.end();
});
```

### Migration Runner

```typescript
// src/lib/migrate.ts
import fs from 'fs';
import path from 'path';
import { db } from './db';
import { logger } from './logger';

export async function runMigrations() {
  try {
    // Create migrations tracking table
    await db.query(`
      CREATE TABLE IF NOT EXISTS migrations (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) UNIQUE NOT NULL,
        executed_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Get list of migration files
    const migrationsDir = path.join(__dirname, '../../migrations');
    const files = fs.readdirSync(migrationsDir).sort();

    for (const file of files) {
      if (!file.endsWith('.sql')) continue;

      // Check if migration already executed
      const check = await db.query(
        'SELECT * FROM migrations WHERE name = $1',
        [file]
      );

      if (check.rows.length > 0) {
        logger.info(`Migration ${file} already executed, skipping`);
        continue;
      }

      // Read and execute migration
      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
      
      logger.info(`Running migration ${file}...`);
      await db.query(sql);
      
      // Record migration
      await db.query(
        'INSERT INTO migrations (name) VALUES ($1)',
        [file]
      );
      
      logger.info(`Migration ${file} completed`);
    }

    logger.info('All migrations completed successfully');
  } catch (error) {
    logger.error('Migration failed:', error);
    throw error;
  }
}

// Run migrations if called directly
if (import.meta.main) {
  runMigrations()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}
```

### Database Seed Script

```typescript
// scripts/seed.ts
import { db } from '../src/lib/db';
import { logger } from '../src/lib/logger';

async function seed() {
  try {
    logger.info('Seeding database...');

    // Create test users
    const userIds = [];
    for (let i = 1; i <= 5; i++) {
      const result = await db.query(
        `INSERT INTO users (email, name) 
         VALUES ($1, $2) 
         RETURNING id`,
        [`user${i}@example.com`, `Test User ${i}`]
      );
      userIds.push(result.rows[0].id);
    }

    logger.info(`Created ${userIds.length} users`);

    // Create test events
    const events = [
      {
        name: 'Coldplay Concert',
        totalTickets: 100,
        priceCents: 15000,
        eventDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days from now
      },
      {
        name: 'Taylor Swift Concert',
        totalTickets: 50,
        priceCents: 20000,
        eventDate: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000), // 60 days from now
      },
    ];

    for (const event of events) {
      await db.query(
        `INSERT INTO events (name, total_tickets, available_tickets, price_cents, event_date)
         VALUES ($1, $2, $2, $3, $4)`,
        [event.name, event.totalTickets, event.priceCents, event.eventDate]
      );
    }

    logger.info(`Created ${events.length} events`);
    logger.info('Database seeded successfully');
    
  } catch (error) {
    logger.error('Seeding failed:', error);
    throw error;
  }
}

seed()
  .then(() => process.exit(0))
  .catch(() => process.exit(1));
```

### Event Repository (Optional Abstraction)

```typescript
// src/repositories/eventRepository.ts
import { db } from '../lib/db';

export interface Event {
  id: string;
  name: string;
  totalTickets: number;
  availableTickets: number;
  priceCents: number;
  eventDate: Date;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export class EventRepository {
  async findAll(limit = 50, offset = 0): Promise<Event[]> {
    const result = await db.query(
      `SELECT * FROM events 
       ORDER BY event_date ASC 
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );
    return result.rows;
  }

  async findById(id: string): Promise<Event | null> {
    const result = await db.query(
      'SELECT * FROM events WHERE id = $1',
      [id]
    );
    return result.rows[0] || null;
  }

  async create(event: Omit<Event, 'id' | 'version' | 'createdAt' | 'updatedAt'>): Promise<Event> {
    const result = await db.query(
      `INSERT INTO events (name, total_tickets, available_tickets, price_cents, event_date)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [
        event.name,
        event.totalTickets,
        event.availableTickets,
        event.priceCents,
        event.eventDate,
      ]
    );
    return result.rows[0];
  }
}
```

### Middleware Examples

```typescript
// src/middleware/validator.ts
import { Request, Response, NextFunction } from 'express';
import { z, ZodError } from 'zod';

export const validateRequest = (schema: z.ZodSchema) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      await schema.parseAsync({
        body: req.body,
        query: req.query,
        params: req.params,
        headers: req.headers,
      });
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        return res.status(400).json({
          error: 'Validation failed',
          details: error.errors,
        });
      }
      next(error);
    }
  };
};
```

```typescript
// src/middleware/rateLimiter.ts
import rateLimit from 'express-rate-limit';
import { redis } from '../lib/redis';

export const rateLimiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000'),
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100'),
  message: 'Too many requests, please try again later',
  standardHeaders: true,
  legacyHeaders: false,
  // Use Redis store for distributed rate limiting
  store: {
    async increment(key: string) {
      const current = await redis.incr(key);
      if (current === 1) {
        await redis.expire(key, 60);
      }
      return { totalHits: current, resetTime: new Date(Date.now() + 60000) };
    },
    async decrement(key: string) {
      await redis.decr(key);
    },
    async resetKey(key: string) {
      await redis.del(key);
    },
  },
});
```

```typescript
// src/middleware/errorHandler.ts
import { Request, Response, NextFunction } from 'express';
import { logger } from '../lib/logger';

export const errorHandler = (
  error: Error,
  req: Request,
  res: Response,
  next: NextFunction
) => {
  logger.error({
    message: error.message,
    stack: error.stack,
    path: req.path,
    method: req.method,
  });

  if (error.name === 'PrismaClientKnownRequestError') {
    return res.status(400).json({
      error: 'Database error',
      message: 'Invalid request',
    });
  }

  res.status(500).json({
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? error.message : undefined,
  });
};
```

### Testing with Bun

```typescript
// tests/unit/bookingService.test.ts
import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { db } from '../../src/lib/db';
import { BookingService } from '../../src/services/bookingService';

const bookingService = new BookingService();

describe('BookingService', () => {
  let testUserId: string;
  let testEventId: string;

  beforeAll(async () => {
    // Create test user
    const userResult = await db.query(
      `INSERT INTO users (email, name) 
       VALUES ($1, $2) 
       RETURNING id`,
      ['test@example.com', 'Test User']
    );
    testUserId = userResult.rows[0].id;

    // Create test event
    const eventResult = await db.query(
      `INSERT INTO events (name, total_tickets, available_tickets, price_cents, event_date)
       VALUES ($1, $2, $2, $3, $4)
       RETURNING id`,
      ['Test Concert', 100, 5000, new Date(Date.now() + 86400000)]
    );
    testEventId = eventResult.rows[0].id;
  });

  afterAll(async () => {
    // Clean up test data
    await db.query('DELETE FROM bookings WHERE user_id = $1', [testUserId]);
    await db.query('DELETE FROM events WHERE id = $1', [testEventId]);
    await db.query('DELETE FROM users WHERE id = $1', [testUserId]);
  });

  test('should create pending booking', async () => {
    const result = await bookingService.queueBooking(
      testUserId,
      testEventId,
      'idempotency-key-123'
    );

    expect(result.status).toBe('PENDING');
    expect(result.bookingId).toBeDefined();
  });

  test('should handle optimistic locking correctly', async () => {
    // Create event with only 1 ticket
    const eventResult = await db.query(
      `INSERT INTO events (name, total_tickets, available_tickets, price_cents, event_date)
       VALUES ($1, $2, $2, $3, $4)
       RETURNING id`,
      ['Limited Event', 1, 5000, new Date(Date.now() + 86400000)]
    );
    const limitedEventId = eventResult.rows[0].id;

    // Create two bookings
    const booking1Result = await db.query(
      `INSERT INTO bookings (user_id, event_id, status)
       VALUES ($1, $2, $3)
       RETURNING id`,
      [testUserId, limitedEventId, 'PENDING']
    );
    const booking1Id = booking1Result.rows[0].id;

    const booking2Result = await db.query(
      `INSERT INTO bookings (user_id, event_id, status)
       VALUES ($1, $2, $3)
       RETURNING id`,
      [testUserId, limitedEventId, 'PENDING']
    );
    const booking2Id = booking2Result.rows[0].id;

    // First booking should succeed
    await expect(
      bookingService.processBooking(booking1Id, limitedEventId)
    ).resolves.toBeDefined();

    // Second booking should fail (no tickets left)
    await expect(
      bookingService.processBooking(booking2Id, limitedEventId)
    ).rejects.toThrow('No tickets available');

    // Clean up
    await db.query('DELETE FROM bookings WHERE event_id = $1', [limitedEventId]);
    await db.query('DELETE FROM events WHERE id = $1', [limitedEventId]);
  });

  test('should idempotently handle duplicate requests', async () => {
    const idempotencyKey = 'duplicate-key-789';

    const result1 = await bookingService.queueBooking(
      testUserId,
      testEventId,
      idempotencyKey
    );

    const result2 = await bookingService.queueBooking(
      testUserId,
      testEventId,
      idempotencyKey
    );

    // Should return the same booking ID
    expect(result1.bookingId).toBe(result2.bookingId);
  });
});
```

### Integration Test with Transactions

```typescript
// tests/integration/concurrency.test.ts
import { describe, test, expect } from 'bun:test';
import { db } from '../../src/lib/db';
import { BookingService } from '../../src/services/bookingService';

describe('Concurrency Tests', () => {
  test('should not oversell tickets under concurrent load', async () => {
    // Create event with 10 tickets
    const eventResult = await db.query(
      `INSERT INTO events (name, total_tickets, available_tickets, price_cents, event_date)
       VALUES ($1, $2, $2, $3, $4)
       RETURNING id`,
      ['Concurrent Test Event', 10, 5000, new Date(Date.now() + 86400000)]
    );
    const eventId = eventResult.rows[0].id;

    // Create 20 users
    const userIds: string[] = [];
    for (let i = 0; i < 20; i++) {
      const result = await db.query(
        `INSERT INTO users (email, name) VALUES ($1, $2) RETURNING id`,
        [`concurrent${i}@test.com`, `User ${i}`]
      );
      userIds.push(result.rows[0].id);
    }

    // Create 20 bookings
    const bookingIds: string[] = [];
    for (const userId of userIds) {
      const result = await db.query(
        `INSERT INTO bookings (user_id, event_id, status)
         VALUES ($1, $2, $3)
         RETURNING id`,
        [userId, eventId, 'PENDING']
      );
      bookingIds.push(result.rows[0].id);
    }

    const bookingService = new BookingService();

    // Process all bookings concurrently
    const results = await Promise.allSettled(
      bookingIds.map((bookingId) =>
        bookingService.processBooking(bookingId, eventId)
      )
    );

    const successful = results.filter((r) => r.status === 'fulfilled').length;
    const failed = results.filter((r) => r.status === 'rejected').length;

    // Verify exactly 10 succeeded and 10 failed
    expect(successful).toBe(10);
    expect(failed).toBe(10);

    // Verify database state
    const eventCheck = await db.query(
      'SELECT available_tickets FROM events WHERE id = $1',
      [eventId]
    );
    expect(eventCheck.rows[0].available_tickets).toBe(0);

    const bookingCount = await db.query(
      `SELECT COUNT(*) FROM bookings 
       WHERE event_id = $1 AND status = 'CONFIRMED'`,
      [eventId]
    );
    expect(parseInt(bookingCount.rows[0].count)).toBe(10);

    // Clean up
    await db.query('DELETE FROM bookings WHERE event_id = $1', [eventId]);
    await db.query('DELETE FROM events WHERE id = $1', [eventId]);
    for (const userId of userIds) {
      await db.query('DELETE FROM users WHERE id = $1', [userId]);
    }
  });
});
```

### Queue Worker

```typescript
// src/worker.ts
import { Worker } from 'bullmq';
import { redis } from './lib/redis';
import { BookingService } from './services/bookingService';
import { logger } from './lib/logger';

const bookingService = new BookingService();

const worker = new Worker(
  'bookings',
  async (job) => {
    const { bookingId, eventId } = job.data;
    
    logger.info(`Processing booking ${bookingId}`);
    
    try {
      const booking = await bookingService.processBooking(bookingId, eventId);
      
      // Emit WebSocket event (if connected)
      // io.to(booking.userId).emit('booking:confirmed', booking);
      
      return booking;
    } catch (error) {
      logger.error(`Booking failed: ${error.message}`);
      throw error; // BullMQ will retry
    }
  },
  {
    connection: redis,
    concurrency: 5,
    limiter: {
      max: 100,
      duration: 1000, // 100 jobs per second
    },
  }
);

worker.on('completed', (job) => {
  logger.info(`Job ${job.id} completed`);
});

worker.on('failed', (job, err) => {
  logger.error(`Job ${job?.id} failed: ${err.message}`);
});

console.log('Worker started');
```

### Prisma Schema

```prisma
// prisma/schema.prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model User {
  id        String    @id @default(uuid())
  email     String    @unique
  name      String
  bookings  Booking[]
  createdAt DateTime  @default(now())
}

model Event {
  id               String    @id @default(uuid())
  name             String
  totalTickets     Int
  availableTickets Int
  priceCents       Int
  eventDate        DateTime
  version          Int       @default(1)
  bookings         Booking[]
  createdAt        DateTime  @default(now())
  updatedAt        DateTime  @updatedAt

  @@index([eventDate])
}

model Booking {
  id              String         @id @default(uuid())
  userId          String
  eventId         String
  status          String         // PENDING, RESERVED, CONFIRMED, FAILED, CANCELLED
  idempotencyKey  String?        @unique
  expiresAt       DateTime?
  createdAt       DateTime       @default(now())
  updatedAt       DateTime       @updatedAt
  
  user            User           @relation(fields: [userId], references: [id])
  event           Event          @relation(fields: [eventId], references: [id])
  bookingEvents   BookingEvent[]

  @@index([userId])
  @@index([eventId])
  @@index([status])
}

model BookingEvent {
  id        String   @id @default(uuid())
  bookingId String
  eventType String   // RESERVED, PAYMENT_PROCESSED, CONFIRMED, CANCELLED
  payload   Json
  createdAt DateTime @default(now())
  
  booking   Booking  @relation(fields: [bookingId], references: [id])

  @@index([bookingId])
}
```

### Load Test Script (using Bun)

```typescript
// tests/load/loadTest.ts
import { z } from 'zod';

const API_URL = 'http://localhost:3000';
const CONCURRENT_USERS = 1000;
const EVENT_ID = 'your-event-id';

async function attemptBooking(userId: string) {
  const idempotencyKey = crypto.randomUUID();
  
  try {
    const response = await fetch(`${API_URL}/api/v1/bookings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': idempotencyKey,
      },
      body: JSON.stringify({
        userId,
        eventId: EVENT_ID,
      }),
    });

    return {
      success: response.ok,
      status: response.status,
      bookingId: response.ok ? (await response.json()).bookingId : null,
    };
  } catch (error) {
    return { success: false, status: 0, bookingId: null };
  }
}

async function runLoadTest() {
  console.log(`Starting load test with ${CONCURRENT_USERS} concurrent users...`);
  
  const startTime = Date.now();
  
  const promises = Array.from({ length: CONCURRENT_USERS }, (_, i) =>
    attemptBooking(`user-${i}`)
  );

  const results = await Promise.all(promises);
  
  const endTime = Date.now();
  const duration = (endTime - startTime) / 1000;

  const successful = results.filter((r) => r.success).length;
  const failed = results.filter((r) => !r.success).length;

  console.log('\n📊 Load Test Results:');
  console.log(`Duration: ${duration.toFixed(2)}s`);
  console.log(`Successful bookings: ${successful}`);
  console.log(`Failed bookings: ${failed}`);
  console.log(`Requests per second: ${(CONCURRENT_USERS / duration).toFixed(2)}`);

  // Verify database state
  // Add database query here to verify exactly 100 tickets sold
}

runLoadTest();
```

---

## 📦 Project Structure

```
tickethive/
├── src/
│   ├── server.ts              # API server entrypoint
│   ├── worker.ts              # Queue worker entrypoint
│   ├── routes/
│   │   ├── events.ts          # Event routes
│   │   ├── bookings.ts        # Booking routes
│   │   └── health.ts          # Health/metrics routes
│   ├── controllers/
│   │   ├── eventController.ts
│   │   └── bookingController.ts
│   ├── services/
│   │   ├── bookingService.ts  # Core booking logic
│   │   ├── eventService.ts
│   │   └── queueService.ts    # BullMQ wrapper
│   ├── repositories/
│   │   ├── eventRepository.ts # DB access layer
│   │   └── bookingRepository.ts
│   ├── middleware/
│   │   ├── errorHandler.ts
│   │   ├── rateLimiter.ts
│   │   ├── validator.ts
│   │   └── logger.ts
│   ├── types/
│   │   ├── booking.ts         # TypeScript types
│   │   └── event.ts
│   ├── lib/
│   │   ├── db.ts              # Prisma client
│   │   ├── redis.ts           # Redis client
│   │   ├── metrics.ts         # Prometheus metrics
│   │   └── logger.ts          # Pino setup
│   └── utils/
│       └── idempotency.ts
├── prisma/
│   ├── schema.prisma          # Database schema
│   ├── migrations/            # DB migrations
│   └── seed.ts                # Seed data
├── tests/
│   ├── unit/
│   ├── integration/
│   └── load/
│       └── loadTest.ts        # K6 or custom script
├── docker/
│   ├── Dockerfile.api
│   └── Dockerfile.worker
├── docker-compose.yml
├── bunfig.toml                # Bun configuration
├── tsconfig.json
└── README.md
```

---

## 🐳 Docker Setup

### docker-compose.yml
```yaml
version: '3.8'

services:
  postgres:
    image: postgres:15-alpine
    environment:
      POSTGRES_USER: tickethive
      POSTGRES_PASSWORD: dev_password
      POSTGRES_DB: tickethive
    ports:
      - '5432:5432'
    volumes:
      - postgres_data:/var/lib/postgresql/data

  redis:
    image: redis:7-alpine
    ports:
      - '6379:6379'
    volumes:
      - redis_data:/data

  api:
    build:
      context: .
      dockerfile: docker/Dockerfile.api
    ports:
      - '3000:3000'
    environment:
      DATABASE_URL: postgresql://tickethive:dev_password@postgres:5432/tickethive
      REDIS_URL: redis://redis:6379
      PORT: 3000
    depends_on:
      - postgres
      - redis
    volumes:
      - ./src:/app/src

  worker:
    build:
      context: .
      dockerfile: docker/Dockerfile.worker
    environment:
      DATABASE_URL: postgresql://tickethive:dev_password@postgres:5432/tickethive
      REDIS_URL: redis://redis:6379
    depends_on:
      - postgres
      - redis
    volumes:
      - ./src:/app/src

volumes:
  postgres_data:
  redis_data:
```

### Dockerfile.api
```dockerfile
FROM oven/bun:1 as base
WORKDIR /app

# Install dependencies
COPY package.json bun.lockb ./
RUN bun install --frozen-lockfile

# Copy source
COPY . .

# Generate Prisma client
RUN bun prisma generate

# Run migrations (in production, do this separately)
# RUN bun prisma migrate deploy

EXPOSE 3000

CMD ["bun", "run", "src/server.ts"]
```

### Dockerfile.worker
```dockerfile
FROM oven/bun:1 as base
WORKDIR /app

COPY package.json bun.lockb ./
RUN bun install --frozen-lockfile

COPY . .
RUN bun prisma generate

CMD ["bun", "run", "src/worker.ts"]
```

---

## 🔧 Environment Variables

Create a `.env` file:
```bash
# Database
DATABASE_URL="postgresql://tickethive:dev_password@localhost:5432/tickethive"

# Redis
REDIS_URL="redis://localhost:6379"

# API
PORT=3000
NODE_ENV=development

# Queue
QUEUE_CONCURRENCY=5
QUEUE_MAX_JOBS_PER_SECOND=100

# Rate Limiting
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX_REQUESTS=100

# Booking
BOOKING_RESERVATION_TIMEOUT_MINUTES=10
```

---

## ⚡ Performance Considerations

### Why Bun for This Project?
1. **Fast startup time:** Critical for serverless/container restarts
2. **Built-in TypeScript:** No compilation step needed
3. **Native testing:** `bun test` is 3x faster than Jest
4. **High throughput:** Better for handling concurrent HTTP requests
5. **Modern APIs:** Built-in fetch, WebSocket support

### Bun-Specific Optimizations
```typescript
// Use Bun's native SQLite for dev (faster than Postgres)
// In production, still use Postgres
if (process.env.NODE_ENV === 'development') {
  // Bun has native SQLite support
  // But stick with Postgres for prod compatibility
}

// Leverage Bun's fast password hashing
import { password } from 'bun';
await password.hash('user-password', {
  algorithm: 'bcrypt',
  cost: 10,
});
```

---

## 📝 Documentation Requirements

### README Must Include:
1. **Architecture Diagram** (system design)
2. **Database Schema** (with relationships)
3. **API Documentation** (OpenAPI link or inline examples)
4. **Setup Instructions** (one-command setup: `make up`)
5. **Load Test Results** (screenshots + analysis)
6. **Design Decisions** (why queue-based? why optimistic locking?)
7. **Tradeoffs** (what would you do differently at 10x scale?)

### Key Questions to Answer:
- How does the system handle Redis failure?
- What happens if a worker crashes mid-processing?
- How do you prevent double-booking with network retries?
- How would you scale to 1M concurrent users?

---

## ⏱️ Timeline Estimate

**Using Bun + Express + Prisma:**

- **Phase 1 (MVP + Basic CRUD):** 1-2 days
  - Express setup is straightforward
  - Prisma makes schema/migrations easy
  
- **Phase 2 (Transaction Safety):** 1-2 days
  - Prisma transactions are clean
  - Testing lock behavior
  
- **Phase 3 (Queue Architecture):** 3-4 days
  - BullMQ integration
  - Worker implementation
  - WebSocket setup
  
- **Phase 4 (Production Hardening):** 3-4 days
  - Logging, metrics, tracing
  - Testing suite
  - Security middleware
  
- **Documentation + Load Testing:** 2-3 days
  - README with diagrams
  - Load test scripts
  - Performance analysis

**Total:** ~10-15 days of focused work

**Time-Saving Tips:**
- Prisma's migration system is faster than writing raw SQL
- Bun's test runner eliminates Jest configuration overhead
- Express middleware ecosystem is mature (less custom code)

---

## 🎯 Success Metrics (Interview Talking Points)

**Technical Depth:**
- ✅ Understands race conditions (not just mutexes, but distributed scenarios)
- ✅ Knows when to use pessimistic vs. optimistic locking
- ✅ Designed for observability (logs, metrics, traces)
- ✅ Wrote tests that prove correctness, not just coverage

**Production Readiness:**
- ✅ Handles failures gracefully (circuit breakers, retries)
- ✅ Secured API (rate limiting, input validation)
- ✅ Documented design decisions (shows ownership)
- ✅ Containerized for easy deployment

**Architectural Thinking:**
- ✅ Chose async processing to decouple concerns
- ✅ Used Redis for both caching and queuing
- ✅ Implemented idempotency for safe retries
- ✅ Planned for scale (discussed sharding, read replicas)

**Bun-Specific Defense:**
When asked "Why Bun instead of Node.js?"
- ✅ "Wanted to evaluate modern runtime performance for high-concurrency scenarios"
- ✅ "Built-in TypeScript support reduces build complexity"
- ✅ "3-4x faster in benchmarks, which matters for this use case"
- ✅ "Aware it's newer tech—in production, I'd evaluate stability vs. performance tradeoffs"
- ✅ "Shows I stay current with emerging technologies while understanding risks"

---

## 📊 Benchmarking Bun vs Node.js

Include these benchmarks in your README:

```bash
# Run with Node.js
node src/server.ts
# Load test result: X req/s

# Run with Bun
bun src/server.ts
# Load test result: Y req/s (compare!)
```

**Expected Results:**
- Bun should handle 30-50% more requests/second
- Memory usage should be 20-30% lower
- Startup time should be ~2x faster

**Be Honest About Tradeoffs:**
- Smaller ecosystem than Node.js
- Fewer production battle-test stories
- Some npm packages may have compatibility issues
- Document any issues you encounter and workarounds

---

## 🚀 Deployment Checklist

- [ ] All services start with `docker-compose up`
- [ ] Database migrations run automatically (`bun prisma migrate deploy`)
- [ ] Seed data creates sample events (`bun prisma db seed`)
- [ ] Load test script included (`bun run tests/load/loadTest.ts`)
- [ ] API documentation (Swagger/OpenAPI)
- [ ] Environment variables documented in `.env.example`
- [ ] Health checks return proper status codes
- [ ] README has clear setup instructions

### Quick Start Commands
```bash
# Install dependencies
bun install

# Setup database
docker-compose up -d postgres redis

# Run migrations
bun run db:migrate

# Seed database
bun run db:seed

# Run API server
bun run dev:api

# Run worker (in separate terminal)
bun run dev:worker

# Run load test
bun run test:load

# Run tests
bun test
```

### package.json Scripts
```json
{
  "name": "tickethive",
  "version": "1.0.0",
  "scripts": {
    "dev:api": "bun --watch src/server.ts",
    "dev:worker": "bun --watch src/worker.ts",
    "start:api": "bun src/server.ts",
    "start:worker": "bun src/worker.ts",
    "db:migrate": "bun src/lib/migrate.ts",
    "db:seed": "bun scripts/seed.ts",
    "test": "bun test",
    "test:watch": "bun test --watch",
    "test:load": "bun run tests/load/loadTest.ts",
    "lint": "eslint src",
    "format": "prettier --write src",
    "docker:up": "docker-compose up -d",
    "docker:down": "docker-compose down",
    "docker:logs": "docker-compose logs -f"
  },
  "dependencies": {
    "pg": "^8.11.3",
    "bullmq": "^5.0.0",
    "cors": "^2.8.5",
    "express": "^4.18.2",
    "express-rate-limit": "^7.1.5",
    "helmet": "^7.1.0",
    "ioredis": "^5.3.2",
    "pino": "^8.16.2",
    "pino-http": "^8.5.1",
    "prom-client": "^15.1.0",
    "ws": "^8.16.0",
    "zod": "^3.22.4"
  },
  "devDependencies": {
    "@types/express": "^4.17.21",
    "@types/cors": "^2.8.17",
    "@types/pg": "^8.10.9",
    "@types/ws": "^8.5.10",
    "typescript": "^5.3.3"
  }
}
```

---

## 💡 Bonus Points

1. **Helm Chart:** Deploy to Kubernetes (local cluster or Minikube)
2. **Observability Stack:** Grafana + Prometheus dashboards
3. **API Gateway:** Add rate limiting via Nginx or Traefik
4. **Blog Post:** Write about your design decisions
5. **Live Demo:** Deploy to Fly.io or Railway.app

---

## 📚 Key Concepts Demonstrated

- **Concurrency Control:** Pessimistic locking, optimistic locking, idempotency
- **Distributed Systems:** Message queues, eventual consistency, CAP theorem tradeoffs
- **Database Optimization:** Indexing, connection pooling, transaction isolation levels
- **API Design:** REST conventions, versioning, HATEOAS
- **Observability:** Structured logging, metrics, tracing
- **Testing:** Unit, integration, E2E, load testing
- **DevOps:** Docker, CI/CD, infrastructure as code

---

**This project proves you can build scalable, production-ready backend systems—not just CRUD APIs.**
