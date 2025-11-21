import fs from "node:fs";
import postgres from "postgres";
import { env } from "./env.ts";

const password = fs.readFileSync(env.POSTGRES_PASSWORD_FILE, "utf8").trim();

const sql = postgres({
  host: env.POSTGRES_HOST,
  port: Number(env.POSTGRES_PORT),
  database: env.POSTGRES_DB,
  username: env.POSTGRES_USER,
  password,
});

export async function initializeDatabase() {
  try {
    await sql`
      CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        email VARCHAR(255) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        name VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `;

    await sql`
      CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
    `;

    console.log("Database initialization successful");
  } catch (error) {
    console.error("Database initialization failed:", error);
    throw error;
  }
}

export default sql;
