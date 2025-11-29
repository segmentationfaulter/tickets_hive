import { z } from "zod";
import type { JobState, Queue } from "bullmq";

/**
 * Booking Job Data Schema
 *
 * This schema is the contract between API (producer) and Worker (consumer).
 * It defines the exact data structure that flows through the BullMQ queue.
 *
 * Why Zod?
 * - Runtime validation ensures type safety across process boundaries
 * - Catches schema mismatches before jobs are processed
 * - Self-documenting contract for both API and Worker
 *
 * Fields:
 * - userId: UUID of the user creating the booking
 * - eventId: UUID of the event being booked
 * - timestamp: Unix timestamp (milliseconds) when job was created
 */
export const BookingJobSchema = z.object({
  userId: z.uuid("Invalid user ID format"),
  eventId: z.uuid("Invalid event ID format"),
  timestamp: z.number().int().positive("Timestamp must be a positive integer"),
});

/**
 * TypeScript type inferred from the Zod schema
 * Use this for type annotations throughout the codebase
 */
export type BookingJobData = z.infer<typeof BookingJobSchema>;

/**
 * Booking Job Result
 *
 * Return type from the worker processor after successfully processing a booking job.
 * This is what BullMQ stores as job.returnvalue and what gets sent to clients.
 *
 * This type is the second generic parameter to Queue<DataType, ResultType>
 * in the BullMQ Queue constructor.
 *
 * Fields:
 * - success: Always true for successful bookings (failed jobs throw errors)
 * - bookingId: UUID of the created booking record
 * - eventId: UUID of the event that was booked
 * - remainingTickets: Number of tickets still available after this booking
 * - version: Event version after update (for optimistic locking)
 * - processedAt: ISO timestamp when worker completed the job
 *
 * Usage:
 * - Returned by worker processor (Milestone 4+)
 * - Stored in Redis by BullMQ as job.returnvalue
 * - Sent to clients via GET /api/v1/bookings/status/:jobId
 * - Used for SSE real-time updates
 */
export interface BookingJobResult {
  success: true;
  bookingId: string;
  eventId: string;
  remainingTickets: number;
  version: number;
  processedAt: string; // ISO 8601 timestamp (JSON-serializable)
}

/**
 * Job Status Result
 *
 * Return type for GET /api/v1/bookings/status/:jobId endpoint.
 * Used by clients to poll job progress and display booking status.
 *
 * This is a public API contract exposed to HTTP clients, not an internal type.
 *
 * Job States (BullMQ lifecycle):
 * - "not_found": Job ID doesn't exist or was cleaned up
 * - "waiting": In queue, not yet picked by worker
 * - "active": Currently being processed by worker
 * - "completed": Successfully finished
 * - "failed": All retries exhausted
 * - "delayed": Waiting for retry backoff
 * - "prioritized": Priority queue state
 * - "waiting-children": Waiting for child jobs to complete
 * - "paused": Queue is paused
 * - "repeat": Repeatable job
 * - "unknown": Unexpected state (edge case from BullMQ)
 *
 * Usage:
 * - API polling endpoint (MVP)
 * - SSE real-time updates (Production)
 * - Dashboard monitoring (Production)
 */
export type JobStatusResult =
  | { status: "not_found" }
  | {
      status: JobState | "unknown";
      data: BookingJobData;
      result?: BookingJobResult;
      failedReason?: string;
    };

/**
 * Booking Queue Type Alias
 *
 * Standardized BullMQ Queue type for booking jobs.
 * Use this type instead of repeating Queue<BookingJobData, BookingJobResult>.
 *
 * Type Parameters:
 * - DataType: BookingJobData (job input payload)
 * - ResultType: BookingJobResult (job output/return value)
 *
 * Usage:
 * - Queue instantiation in packages/lib/src/queues.ts
 * - Factory function parameters in apps/api/src/services/queueService.ts
 * - Worker processor type annotations (Milestone 4+)
 * - Testing mocks
 */
export type BookingQueue = Queue<BookingJobData, BookingJobResult>;
