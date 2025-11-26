# TicketHive Types Package

Shared TypeScript types and Zod schemas for both API and Worker services.

## Structure
- `src/index.ts` - Barrel exports
- `src/auth.ts` - Authentication types and schemas
- `src/event.ts` - Event types and schemas
- `src/booking.ts` - Booking types and schemas
- `src/api.ts` - API request/response types

## Purpose
- Ensure type consistency across all services
- Provide runtime validation with Zod schemas
- Prevent type mismatches between API and Worker
- Single source of truth for data contracts

## Usage
```typescript
import type { User, Event, Booking } from '@ticket-hive/types';
import { UserSchema, CreateBookingSchema } from '@ticket-hive/types';

// Type-only imports for interfaces
import type { CreateBookingPayload } from '@ticket-hive/types';

// Runtime validation
const validatedData = CreateBookingSchema.parse(request.body);
```

## Type Categories
- **Auth**: User, JWT payload, login/register payloads
- **Event**: Event entity, event creation, event updates
- **Booking**: Booking entity, booking creation, booking status
- **API**: Request/response wrappers, error responses