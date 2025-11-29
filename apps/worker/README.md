# TicketHive Worker Service

Job queue worker for processing asynchronous booking operations using BullMQ.

## Structure
- `src/` - TypeScript source files
- `src/processors/` - Job processors (bookingProcessor.ts)

## Purpose
Handles background job processing for async booking operations:
- Process booking queue jobs from BullMQ
- Execute database operations without blocking API
- Send real-time updates via Server-Sent Events
- Handle booking confirmation/status updates

## Dependencies
- `@ticket-hive/database` - Shared database layer
- `@ticket-hive/types` - Shared TypeScript types
- `@ticket-hive/lib` - Shared utilities
- `bullmq` - Job queue management
- `ioredis` - Redis client
