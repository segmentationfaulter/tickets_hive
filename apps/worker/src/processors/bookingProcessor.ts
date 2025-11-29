import { Job } from "bullmq";
import {
  BookingJobSchema,
  type BookingJobData,
  type BookingJobResult,
} from "@ticket-hive/types";
import { AppError, ErrorCode } from "@ticket-hive/lib";

type Database = typeof import("@ticket-hive/database").sql;

/**
 * Booking Job Processor Factory
 *
 * Creates a processor function with optimistic locking for high-concurrency booking.
 *
 * Optimistic Locking Strategy:
 * - Read event WITHOUT row locks (no blocking between workers)
 * - Update WITH version check (WHERE version = expected)
 * - If version changed → UPDATE returns 0 rows → throw VERSION_CONFLICT
 * - BullMQ automatically retries (max 3 attempts, exponential backoff)
 *
 * Benefits:
 * ✅ Higher throughput (no lock contention)
 * ✅ Better scalability (can add more workers)
 * ⚠️  Version conflicts under high contention (acceptable, retries succeed)
 *
 * @param db - PostgreSQL client (postgres.js instance)
 * @returns Processor function compatible with BullMQ Worker
 */
export function createBookingProcessor(db: Database) {
  return async function bookingProcessor(
    job: Job<BookingJobData>,
  ): Promise<BookingJobResult> {
    // Validate job data (defense in depth - API already validated)
    const data = BookingJobSchema.parse(job.data);
    const { userId, eventId } = data;

    console.log(
      `📦 Processing job ${job.id}: user=${userId}, event=${eventId}`,
    );

    // Execute booking in transaction (atomic event update + booking insert)
    return await db.begin(async (tx) => {
      // Step 1: Read event WITHOUT locking (optimistic approach)
      // No FOR UPDATE = no blocking, other workers can read simultaneously
      const events = await tx<
        Array<{
          id: string;
          available_tickets: number;
          version: number;
        }>
      >`
        SELECT id, available_tickets, version
        FROM events
        WHERE id = ${eventId}
      `;

      // Step 2: Validate event exists
      if (events.length === 0) {
        throw new AppError(ErrorCode.EVENT_NOT_FOUND);
      }

      const event = events[0]!;
      const currentVersion = event.version;

      // Step 3: Check ticket availability (business logic)
      if (event.available_tickets <= 0) {
        throw new AppError(ErrorCode.EVENT_SOLD_OUT);
      }

      // Step 4: Optimistic update with version check
      // CRITICAL: WHERE version = ${currentVersion} prevents concurrent modifications
      // If another worker updated event, version changed and UPDATE returns 0 rows
      const updateResult = await tx<
        Array<{
          id: string;
          available_tickets: number;
          version: number;
        }>
      >`
        UPDATE events
        SET
          available_tickets = available_tickets - 1,
          version = version + 1,
          updated_at = NOW()
        WHERE id = ${eventId}
          AND version = ${currentVersion}
          AND available_tickets > 0
        RETURNING id, available_tickets, version
      `;

      // Step 5: Detect version conflict
      // 0 rows updated means either:
      // - Version changed (conflict with another worker)
      // - Tickets sold out between SELECT and UPDATE
      // Both handled same way: retry
      if (updateResult.length === 0) {
        console.log(
          `⚠️  Version conflict for event ${eventId} (expected v${currentVersion}). BullMQ will retry.`,
        );
        throw new AppError(ErrorCode.VERSION_CONFLICT);
      }

      const updatedEvent = updateResult[0]!;

      // Step 6: Create booking record (same transaction)
      // If this fails, event update rolls back (atomicity guarantee)
      const bookingResult = await tx<
        Array<{
          id: string;
          created_at: Date;
        }>
      >`
        INSERT INTO bookings (user_id, event_id, status, created_at)
        VALUES (${userId}, ${eventId}, 'CONFIRMED', NOW())
        RETURNING id, created_at
      `;

      if (bookingResult.length === 0) {
        throw new Error("INSERT INTO bookings returned no rows");
      }

      const booking = bookingResult[0]!;

      console.log(
        `✅ Booking created: ${booking.id} (${updatedEvent.available_tickets} tickets remaining, version ${updatedEvent.version})`,
      );

      // Step 7: Return job result (stored in Redis by BullMQ)
      // Clients can retrieve via GET /api/v1/bookings/status/:jobId
      return {
        success: true,
        bookingId: booking.id,
        eventId: eventId,
        remainingTickets: updatedEvent.available_tickets,
        version: updatedEvent.version,
        processedAt: new Date().toISOString(),
      };
    });
  };
}
