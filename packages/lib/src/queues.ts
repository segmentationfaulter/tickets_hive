import { Queue } from "bullmq";
import { redis } from "./redis.ts";
import { env } from "./env.ts";
import type { BookingJobData, BookingJobResult, BookingQueue } from "@ticket-hive/types";

/**
 * Booking Queue Configuration
 *
 * This queue handles all ticket booking jobs in Level 3.
 * Jobs are added by the API service and processed by worker service.
 *
 * Queue Name: "booking"
 * - Used as Redis key prefix: bull:booking:*
 * - Must match the queue name in worker processor
 *
 * Connection: Shared ioredis instance
 * - Already configured for BullMQ (maxRetriesPerRequest: null)
 * - Singleton pattern prevents connection leaks
 *
 * Job Options:
 * - attempts: Number of retries before marking job as failed
 * - backoff: Exponential delay between retries (prevents thundering herd)
 * - removeOnComplete: Auto-cleanup to prevent Redis memory bloat
 * - removeOnFail: Keep failed jobs longer for debugging
 */
export const bookingQueue = new Queue<BookingJobData, BookingJobResult>(
  "booking",
  {
    connection: redis,
    defaultJobOptions: {
      // Retry configuration from environment
      attempts: env.WORKER_MAX_RETRIES, // Default: 3
      backoff: {
        type: "exponential",
        delay: env.WORKER_RETRY_DELAY_MS, // Default: 100ms
      },

      // Cleanup policies (prevent Redis memory growth)
      removeOnComplete: {
        age: 3600, // Keep completed jobs for 1 hour (3600 seconds)
        count: 100, // Keep max 100 most recent completed jobs
      },
      removeOnFail: {
        age: 24 * 3600, // Keep failed jobs for 24 hours (debugging)
        count: 1000, // Keep max 1000 most recent failures
      },
    },
  },
);

/**
 * Graceful Shutdown Handler
 *
 * On SIGTERM (Docker stop) or SIGINT (Ctrl+C):
 * 1. Stop accepting new jobs
 * 2. Wait for in-flight jobs to complete
 * 3. Close queue connection
 *
 * This prevents job loss during deployment/restart
 */
const shutdown = async () => {
  console.log("🔄 Closing booking queue...");
  await bookingQueue.close();
  console.log("✅ Booking queue closed");
};

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
