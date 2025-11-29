import { sql } from "@ticket-hive/database";
import type { Booking } from "@ticket-hive/types";
import {
  AppError,
  ErrorCode,
} from "@ticket-hive/lib";

type Database = typeof sql;

interface BookingService {
  getBooking(bookingId: string): Promise<Booking | null>;
  cancelBooking(bookingId: string): Promise<Booking>;
}

function createBookingService(db: Database): BookingService {
  return {
    async getBooking(bookingId: string): Promise<Booking | null> {
      const bookings = await db<Booking[]>`
        SELECT id, user_id, event_id, status, created_at, updated_at
        FROM bookings
        WHERE id = ${bookingId}
      `;

      const booking = bookings[0];
      return booking ?? null;
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
      return await db.begin(async (transaction: any) => {
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
              version = version + 1,
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
