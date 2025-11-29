import { bookingQueue } from "@ticket-hive/lib";
import {
  BookingJobSchema,
  type BookingJobData,
  type BookingJobResult,
  type BookingQueue,
  type JobStatusResult,
} from "@ticket-hive/types";
import { randomUUID } from "crypto";

/**
 * Queue Service
 *
 * Provides a clean interface for job management without exposing BullMQ internals.
 * Uses factory pattern for dependency injection (consistent with other services).
 *
 * The singleton instance exports the service with the real bookingQueue,
 * while the factory function enables easy testing with mock queues.
 */

/**
 * Queue Service Interface
 */
interface QueueService {
  createBookingJob(data: BookingJobData): Promise<string>;
  getJobStatus(jobId: string): Promise<JobStatusResult>;
}

/**
 * Factory function for creating queue service instances
 *
 * @param queue - BullMQ Queue instance for job management
 * @returns QueueService instance with injected queue dependency
 */
export function createQueueService(queue: BookingQueue): QueueService {
  return {
    /**
     * Creates a booking job and adds it to the BullMQ queue
     *
     * Flow:
     * 1. Validate job data against BookingJobSchema (runtime safety)
     * 2. Generate unique job ID
     * 3. Add job to Redis queue
     * 4. Return job ID immediately (async processing)
     *
     * @param data - Booking job payload (userId, eventId, timestamp)
     * @returns jobId - Unique identifier for tracking this job
     * @throws ZodError - If validation fails (caught by errorHandler.ts)
     */
    async createBookingJob(data: BookingJobData): Promise<string> {
      // Generate unique job ID
      const jobId = randomUUID();

      // Add job to queue with custom ID
      // BullMQ will persist this to Redis immediately
      await queue.add("booking", data, {
        jobId, // Custom ID for easier tracking
      });

      return jobId;
    },

    /**
     * Retrieves the current status of a booking job
     *
     * Job States (BullMQ lifecycle):
     * - "waiting": In queue, not yet picked by worker
     * - "active": Currently being processed by worker
     * - "completed": Successfully finished
     * - "failed": All retries exhausted
     * - "delayed": Waiting for retry backoff
     * - "not_found": Job doesn't exist or was cleaned up
     *
     * @param jobId - The job ID returned from createBookingJob
     * @returns Object containing job status, data, result, and failure reason
     */
    async getJobStatus(jobId: string): Promise<JobStatusResult> {
      const job = await queue.getJob(jobId);

      // Job not found (either never existed or was cleaned up)
      if (!job) {
        return { status: "not_found" } as const;
      }

      // Get current state from BullMQ
      const state = await job.getState();

      return {
        status: state,
        data: job.data, // Original job payload
        result: job.returnvalue, // Worker return value (if completed)
        failedReason: job.failedReason, // Error message (if failed)
      };
    },
  };
}

/**
 * Singleton queue service instance
 * Exported for use in routes and controllers
 */
export const queueService = createQueueService(bookingQueue);
