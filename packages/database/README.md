# TicketHive Database Package

Shared database layer for both API and Worker services.

## Structure
- `src/index.ts` - Main entry point and barrel exports
- `src/db.ts` - PostgreSQL connection configuration and sql instance
- `src/schema.ts` - Database schema initialization and table creation

## Features
- Connection pool management with postgres.js
- Transaction support with proper statement timeout
- Schema initialization on startup
- Type-safe SQL queries with TypeScript

## Connection Configuration
- Pool size: 20 connections
- Statement timeout: 5000ms (critical for preventing lock hell)
- Idle timeout: 30s
- Connection timeout: 10s

## Usage
```typescript
import { sql, initializeDatabase } from '@ticket-hive/database';

// Initialize schema
await initializeDatabase();

// Use in transactions
await sql.begin(async (tx) => {
  const result = await tx`SELECT * FROM events WHERE id = ${id} FOR UPDATE`;
  return result[0];
});
```