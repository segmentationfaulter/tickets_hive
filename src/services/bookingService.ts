import sql from "../lib/db.ts";
import type { Booking, CreateBookingPayload } from "../types/index.ts";
import { eventService } from "./eventService.ts";
import { AppError, ErrorCode } from "../lib/errors.ts";

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
      // Step 1: Get event by ID
      const event = await eventService.getEventById(payload.eventId);

      // Step 2: Check if event exists
      if (!event) {
        throw new AppError(ErrorCode.EVENT_NOT_FOUND);
      }

      // Step 3: Check if available tickets > 0
      if (event.available_tickets <= 0) {
        throw new AppError(ErrorCode.EVENT_SOLD_OUT);
      }

      // Step 4: Decrement available_tickets by 1
      // ⚠️ INTENTIONALLY NAIVE - This is where race condition occurs!
      // Multiple concurrent requests can all see available_tickets > 0 and proceed
      await db`
        UPDATE events
        SET available_tickets = available_tickets - 1
        WHERE id = ${payload.eventId}
      `;

      // Step 5: Create booking record
      const bookings = await db<Booking[]>`
        INSERT INTO bookings (user_id, event_id, status)
        VALUES (${userId}, ${payload.eventId}, 'CONFIRMED')
        RETURNING id, user_id, event_id, status, created_at, updated_at
      `;

      if (bookings.length === 0) {
        throw new AppError(ErrorCode.FAILED_TO_CREATE_BOOKING);
      }

      return bookings[0];
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
      // Step 1: Find booking by ID
      const booking = await this.getBooking(bookingId);

      // Step 2: If not found, throw error
      if (!booking) {
        throw new AppError(ErrorCode.BOOKING_NOT_FOUND);
      }

      // Step 3: If already cancelled, throw error
      if (booking.status === "CANCELLED") {
        throw new AppError(ErrorCode.BOOKING_ALREADY_CANCELLED);
      }

      // Step 4: Update booking status to CANCELLED
      const updatedBookings = await db<Booking[]>`
        UPDATE bookings
        SET status = 'CANCELLED', updated_at = NOW()
        WHERE id = ${bookingId}
        RETURNING id, user_id, event_id, status, created_at, updated_at
      `;

      if (updatedBookings.length === 0) {
        throw new AppError(ErrorCode.FAILED_TO_CANCEL_BOOKING);
      }

      const updatedBooking = updatedBookings[0];

      // Step 5: Increment event's available_tickets by 1
      await db`
        UPDATE events
        SET available_tickets = available_tickets + 1
        WHERE id = ${updatedBooking.event_id}
      `;

      return updatedBooking;
    },
  };
}

export const bookingService = createBookingService(sql);
