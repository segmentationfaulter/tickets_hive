import { Worker } from "bullmq";
import { redis } from "@ticket-hive/lib";
import { env } from "@ticket-hive/lib";
import { bookingProcessor } from "./processors/bookingProcessor.ts";

/**
 * Worker Service Entry Point
 *
 * This service processes booking jobs from the Redis queue.
 * It runs independently from the API and can be scaled separately.
 *
 * Architecture:
 * - Connects to same Redis instance as API
 * - Processes jobs with configured concurrency
 * - Handles graceful shutdown on SIGTERM/SIGINT
 */

console.log("🔧 Starting worker service...");
console.log(`Concurrency: ${env.WORKER_CONCURRENCY}`);
console.log(`Max retries: ${env.WORKER_MAX_RETRIES}`);

// Create BullMQ worker
const worker = new Worker("booking", bookingProcessor, {
  connection: redis,
  concurrency: env.WORKER_CONCURRENCY,
});

// Event handlers for observability
worker.on("completed", (job) => {
  console.log(`✅ Job ${job.id} completed successfully`);
});

worker.on("failed", (job, err) => {
  console.error(`❌ Job ${job?.id} failed:`, err.message);
});

worker.on("error", (err) => {
  console.error("❌ Worker error:", err);
});

worker.on("stalled", (jobId) => {
  console.warn(`⚠️  Job ${jobId} stalled`);
});

// Graceful shutdown
async function shutdown() {
  console.log("🛑 Shutting down worker gracefully...");
  await worker.close();
  await redis.quit();
  console.log("✅ Worker shut down complete");
  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

console.log("✅ Worker service started. Listening for jobs on 'booking' queue...");
