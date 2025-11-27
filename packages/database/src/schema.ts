import { sql } from "./db.ts";

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
        version INT DEFAULT 0 NOT NULL,
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

export default initializeDatabase;
