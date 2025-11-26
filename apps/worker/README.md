# TicketHive Worker Service

Job queue worker for processing asynchronous booking operations using BullMQ.

## Structure
- `src/` - TypeScript source files (will be populated in Milestone 4)

## Purpose (Future)
Will handle background job processing for Level 3 async booking operations:
- Process booking queue jobs from BullMQ
- Execute database operations without blocking API
- Send real-time updates via Server-Sent Events
- Handle booking confirmation/status updates

## Dependencies (Future)
- `@ticket-hive/database` - Shared database layer
- `@ticket-hive/types` - Shared TypeScript types
- `@ticket-hive/lib` - Shared utilities
- `bullmq` - Job queue management
- `ioredis` - Redis client