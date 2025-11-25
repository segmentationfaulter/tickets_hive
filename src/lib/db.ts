import fs from "node:fs";
import postgres from "postgres";
import { env } from "./env.ts";

let password: string;
try {
  password = fs.readFileSync(env.POSTGRES_PASSWORD_FILE, "utf8").trim();
} catch (error) {
  console.error("❌ Failed to read PostgreSQL password file:");
  console.error(`   File path: ${env.POSTGRES_PASSWORD_FILE}`);
  console.error(`   Error: ${error.message}`);
  console.error(
    "💡 Please ensure the password file exists and contains a valid password",
  );
  process.exit(1);
}

if (!password) {
  console.error("💡 Please ensure the password file is not empty");
  process.exit(1);
}

/**
 * PostgreSQL Connection Configuration for TicketHive
 *
 * Level 2 Enhancement: Connection Pooling & Timeout Configuration
 *
 * Connection Pool Settings:
 * - max: 20 connections - Balances concurrency with database resource limits
 *   * Allows handling ~50-100 concurrent requests efficiently
 *   * Prevents overwhelming the database with too many connections
 *   * PostgreSQL default max_connections is typically 100, leaving room for other services
 *
 * - idle_timeout: 30 seconds - Closes idle connections to free up resources
 *   * Prevents connection leaks from abandoned connections
 *   * Balances between reusing connections and freeing unused resources
 *   * Particularly important in serverless or auto-scaling environments
 *
 * - connect_timeout: 10 seconds - Fails fast if database is unreachable
 *   * Prevents requests from hanging indefinitely during database outages
 *   * Gives quick feedback to clients that the service is unavailable
 *   * Default is 30s, but 10s is more responsive for user-facing APIs
 *
 * Statement Timeout:
 * - statement_timeout: 5000ms (5 seconds) - Prevents queries from hanging indefinitely
 *   * CRITICAL for Level 2's FOR UPDATE locks under high contention
 *   * If a transaction holds a lock for >5s, PostgreSQL terminates it
 *   * Prevents cascading delays where hundreds of requests wait for one slow transaction
 *   * Returns error code 57014 (query_canceled) which we handle as STATEMENT_TIMEOUT
 *
 * Why These Specific Values?
 * - 20 max connections: Tested with 1000 concurrent requests on 100-ticket events
 *   * Sweet spot between throughput and database load
 *   * Can be increased to 30-50 for higher traffic, but watch CPU/memory
 *
 * - 5s statement timeout: Long enough for legitimate operations, short enough to prevent cascading delays
 *   * Normal booking operation: <100ms
 *   * Under high contention: 100-500ms waiting for locks
 *   * Extreme contention: Some requests timeout after 5s (better than waiting indefinitely)
 *   * If >20% of requests timeout, consider Level 3 (queues) instead of increasing this value
 *
 * Trade-offs:
 * ✅ Pros:
 *    - Prevents indefinite lock waits
 *    - Fails fast with clear error messages
 *    - Protects database from connection exhaustion
 *    - Makes system behavior predictable under load
 *
 * ⚠️ Cons:
 *    - Some legitimate requests may timeout under extreme load (acceptable)
 *    - Lower max connections = lower theoretical throughput (but higher reliability)
 *    - Requires clients to implement retry logic for 503 errors
 *
 * When to Adjust:
 * - Increase max connections: If connection pool exhaustion errors occur frequently
 * - Increase statement_timeout: If legitimate operations are timing out (but investigate why first!)
 * - Decrease statement_timeout: If you want even faster failure under contention (not recommended)
 *
 * Next Level (Level 3):
 * When these timeouts become a bottleneck (>20% timeout rate), implement:
 * - BullMQ job queues for asynchronous processing
 * - Return 202 Accepted immediately, process bookings in background workers
 * - This eliminates timeout issues by decoupling request acceptance from processing
 */
const sql = postgres({
  host: env.POSTGRES_HOST,
  port: Number(env.POSTGRES_PORT),
  database: env.POSTGRES_DB,
  username: env.POSTGRES_USER,
  password,

  // Connection Pool Configuration
  max: 20, // Maximum connections in pool
  idle_timeout: 30, // Close idle connections after 30 seconds
  connect_timeout: 10, // Timeout for initial connection (seconds)

  // PostgreSQL Connection Parameters
  connection: {
    application_name: "tickethive", // Shows up in pg_stat_activity for monitoring and troubleshooting
    statement_timeout: 5000, // 5 second query timeout (milliseconds)
  },
});

export async function initializeDatabase() {
  try {
    // Create ENUM type for user roles if it doesn't exist
    await sql`
      CREATE TYPE user_role AS ENUM ('user', 'admin');
    `.catch(() => {
      // Type might already exist, ignore error
    });

    // Create ENUM type for booking status if it doesn't exist
    await sql`
      CREATE TYPE booking_status AS ENUM ('CONFIRMED', 'CANCELLED');
    `.catch(() => {
      // Type might already exist, ignore error
    });

    await sql`
      CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        email VARCHAR(255) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        name VARCHAR(255) NOT NULL,
        role user_role DEFAULT 'user',
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `;

    await sql`
      CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS events (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name VARCHAR(255) NOT NULL,
        total_tickets INT NOT NULL,
        available_tickets INT NOT NULL,
        event_date TIMESTAMP NOT NULL,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `;

    await sql`
      CREATE INDEX IF NOT EXISTS idx_events_event_date ON events(event_date);
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS bookings (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
        status booking_status NOT NULL DEFAULT 'CONFIRMED',
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `;

    await sql`
      CREATE INDEX IF NOT EXISTS idx_bookings_user_id ON bookings(user_id);
    `;

    await sql`
      CREATE INDEX IF NOT EXISTS idx_bookings_event_id ON bookings(event_id);
    `;

    await sql`
      CREATE INDEX IF NOT EXISTS idx_bookings_status ON bookings(status);
    `;

    console.log("Database initialization successful");
  } catch (error) {
    console.error("Database initialization failed:", error);
    throw error;
  }
}

export default sql;
