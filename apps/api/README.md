# TicketHive API Service

Main Express.js API service for handling HTTP requests and managing the application layer.

## Structure
- `src/` - TypeScript source files
  - `index.ts` - Application entry point
  - `routes/` - Express route handlers
  - `services/` - Business logic layer
  - `middleware/` - Express middleware (auth, validation, etc.)
  - `lib/` - API-specific utilities (not shared with worker)

## Scripts
- `npm run dev` - Development mode with hot reload
- `npm run build` - Type checking only
- `npm start` - Production mode

## Dependencies
- `@ticket-hive/database` - Shared database layer
- `@ticket-hive/types` - Shared TypeScript types
- `@ticket-hive/lib` - Shared utilities
- Express.js and related middleware