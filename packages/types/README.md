# TicketHive Types Package

Shared TypeScript types and Zod schemas for both API and Worker services.

## Structure
- `src/index.ts` - Barrel exports
- `src/auth.ts` - Authentication types and schemas
- `src/event.ts` - Event types and schemas
- `src/booking.ts` - Booking types
- `src/bookingJob.ts` - BullMQ job types and schemas
- `src/api.ts` - API request/response types

## Purpose
- Ensure type consistency across all services
- Provide runtime validation with Zod schemas
- Prevent type mismatches between API and Worker
- Single source of truth for data contracts

## Usage
```typescript
import type { User, Event, Booking } from '@ticket-hive/types';
import { BookingJobSchema } from '@ticket-hive/types';

// Type-only imports for interfaces
import type { BookingJobData, SuccessResponse, ErrorResponse } from '@ticket-hive/types';

// Runtime validation (Zod schemas)
const validatedJobData = BookingJobSchema.parse(requestData);
```

## Type Categories
- **Auth**: User, JWT payload, login/register payloads, decoded token
- **Event**: Event entity, event creation, event responses with pagination
- **Booking**: Booking entity, booking status, async job responses
- **BookingJob**: BullMQ job data, job results, job status (queue system)
- **API**: SuccessResponse<T> and ErrorResponse wrappers