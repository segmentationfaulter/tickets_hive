import sql from "../lib/db.ts";
import type { Booking, CreateBookingPayload } from "../types/index.ts";
import { eventService } from "./eventService.ts";
import {
  AppError,
  ErrorCode,
  isAppError,
  isPostgresTimeoutError,
  isConnectionTimeoutError,
  isPostgresUniqueConstraintError,
  isPostgresForeignKeyViolationError,
} from "../lib/errors.ts";

type Database = typeof sql;

interface BookingService {
  createBooking(
    userId: string,
    payload: CreateBookingPayload,
  ): Promise<Booking>;
  getBooking(bookingId: string): Promise<Booking | null>;
  cancelBooking(bookingId: string): Promise<Booking>;
}

function createBookingService(db: Database): BookingService {
  return {
    async createBooking(
      userId: string,
      payload: CreateBookingPayload,
    ): Promise<Booking> {
      /**
       * Level 2 Implementation: Database Transaction with Pessimistic Locking
       * Level 2 Enhancement: Service Layer Error Handling
       *
       * This method uses PostgreSQL transactions with row-level locking (FOR UPDATE)
       * to prevent race conditions when multiple users try to book tickets concurrently.
       *
       * How it works:
       * 1. BEGIN TRANSACTION - Start atomic operation
       * 2. SELECT ... FOR UPDATE - Lock the event row (prevents other transactions from reading/modifying)
       * 3. Validate event exists and has available tickets
       * 4. Decrement available_tickets
       * 5. Insert booking record
       * 6. COMMIT - If all steps succeed, commit changes
       * 7. ROLLBACK - If any step fails, rollback all changes
       *
       * Trade-offs:
       * ✅ Pros: 100% data integrity, no race conditions, ACID compliance
       * ⚠️ Cons: Lower throughput (requests serialize), higher latency under load
       *
       * Why FOR UPDATE is critical:
       * Without FOR UPDATE, multiple transactions could read the same available_tickets value
       * simultaneously, all see tickets available, and all proceed to create bookings,
       * resulting in overbooking. FOR UPDATE creates a lock that forces other transactions
       * to wait until this transaction completes (COMMIT or ROLLBACK).
       *
       * Error Handling Strategy:
       * We wrap the transaction in try-catch to convert database-specific errors
       * into application errors (AppError). This separation of concerns allows:
       * - Service layer: Focus on business logic and error classification
       * - Route layer: Handle HTTP response formatting
       * - Error layer: Centralized error definitions
       *
       * See detailed error handling documentation in src/lib/errors.ts
       */
      return await db.begin(async (transaction) => {
        // Step 1: Lock the event row with FOR UPDATE
        // This prevents other transactions from reading or modifying this event
        // until our transaction completes (COMMIT or ROLLBACK)
        const events = await transaction<
          Array<{
            id: string;
            name: string;
            available_tickets: number;
          }>
        >`
          SELECT id, name, available_tickets
          FROM events
          WHERE id = ${payload.eventId}
          FOR UPDATE
        `;

        // Step 2: Validate event exists
        if (events.length === 0) {
          throw new AppError(ErrorCode.EVENT_NOT_FOUND);
        }

        const event = events[0];

        // Step 3: Check if tickets are available
        // This check is now safe because we hold an exclusive lock on this row
        if (event.available_tickets <= 0) {
          throw new AppError(ErrorCode.EVENT_SOLD_OUT);
        }

        // Step 4: Decrement available_tickets (within same transaction)
        await transaction`
          UPDATE events
          SET available_tickets = available_tickets - 1,
              updated_at = NOW()
          WHERE id = ${payload.eventId}
        `;

        // Step 5: Create booking record (within same transaction)
        // If this fails, the entire transaction rolls back (including the ticket decrement)
        const bookings = await transaction<Booking[]>`
          INSERT INTO bookings (user_id, event_id, status)
          VALUES (${userId}, ${payload.eventId}, 'CONFIRMED')
          RETURNING id, user_id, event_id, status, created_at, updated_at
        `;

        if (bookings.length === 0) {
          throw new Error("INSERT INTO bookings returned no rows");
        }

        // If we reach here, transaction will COMMIT automatically
        // The lock is released and other waiting transactions can proceed
        return bookings[0];
      });
    },

    async getBooking(bookingId: string): Promise<Booking | null> {
      const bookings = await db<Booking[]>`
        SELECT id, user_id, event_id, status, created_at, updated_at
        FROM bookings
        WHERE id = ${bookingId}
      `;

      return bookings.length > 0 ? bookings[0] : null;
    },

    async cancelBooking(bookingId: string): Promise<Booking> {
      /**
       * Level 2 Implementation: Transactional Booking Cancellation
       *
       * This method uses PostgreSQL transactions with row-level locking (FOR UPDATE)
       * to ensure atomic cancellation and ticket restoration.
       *
       * How it works:
       * 1. BEGIN TRANSACTION - Start atomic operation
       * 2. SELECT ... FOR UPDATE - Lock the booking row (prevents double-cancellation)
       * 3. Validate booking exists and is not already cancelled
       * 4. Update booking status to CANCELLED
       * 5. Increment event's available_tickets (restore the ticket)
       * 6. COMMIT - If all steps succeed, commit changes
       * 7. ROLLBACK - If any step fails, rollback all changes
       *
       * Why FOR UPDATE is critical:
       * Without FOR UPDATE, two concurrent cancellation requests for the same booking
       * could both see status='CONFIRMED', both proceed to cancel, and both increment
       * available_tickets, resulting in incorrect ticket count (+2 instead of +1).
       * FOR UPDATE ensures only one cancellation can proceed at a time.
       *
       * Atomicity guarantee:
       * Either BOTH the booking is cancelled AND the ticket is restored, or NEITHER happens.
       * This prevents data inconsistency where a booking is marked cancelled but the
       * ticket count is not updated (or vice versa).
       *
       * Error Handling Strategy:
       * Errors are allowed to propagate to the route layer for centralized handling.
       */
      return await db.begin(async (transaction) => {
        // Step 1: Lock the booking row with FOR UPDATE
        // This prevents other transactions from modifying this booking
        // until our transaction completes (prevents double-cancellation)
        const bookings = await transaction<Booking[]>`
          SELECT id, user_id, event_id, status, created_at, updated_at
          FROM bookings
          WHERE id = ${bookingId}
          FOR UPDATE
        `;

        // Step 2: Validate booking exists
        if (bookings.length === 0) {
          throw new AppError(ErrorCode.BOOKING_NOT_FOUND);
        }

        const booking = bookings[0];

        // Step 3: Check if booking is already cancelled
        // This check is now safe because we hold an exclusive lock on this row
        if (booking.status === "CANCELLED") {
          throw new AppError(ErrorCode.BOOKING_ALREADY_CANCELLED);
        }

        // Step 4: Update booking status to CANCELLED (within same transaction)
        const updatedBookings = await transaction<Booking[]>`
          UPDATE bookings
          SET status = 'CANCELLED', updated_at = NOW()
          WHERE id = ${bookingId}
          RETURNING id, user_id, event_id, status, created_at, updated_at
        `;

        if (updatedBookings.length === 0) {
          throw new Error("UPDATE bookings returned no rows");
        }

        const updatedBooking = updatedBookings[0];

        // Step 5: Restore the ticket to the event (within same transaction)
        // If this fails, the entire transaction rolls back (booking stays CONFIRMED)
        await transaction`
          UPDATE events
          SET available_tickets = available_tickets + 1,
              updated_at = NOW()
          WHERE id = ${updatedBooking.event_id}
        `;

        // If we reach here, transaction will COMMIT automatically
        // Both the booking cancellation and ticket restoration are persisted atomically
        return updatedBooking;
      });
    },
  };
}

export const bookingService = createBookingService(sql);
