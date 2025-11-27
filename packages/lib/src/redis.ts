import { Redis } from "ioredis";
import { env, getRedisPassword } from "./env.ts";

/**
 * Shared Redis connection for BullMQ
 *
 * BullMQ requires ioredis (not node-redis) for connection handling.
 * This creates a singleton connection used by both queues and workers.
 *
 * Configuration:
 * - maxRetriesPerRequest: null - Required for BullMQ to handle retries properly
 * - retryStrategy: Exponential backoff up to 2 seconds
 *
 * The connection is automatically closed on SIGTERM for graceful shutdown.
 */
export const redis = new Redis({
  host: env.REDIS_HOST,
  port: env.REDIS_PORT,
  password: getRedisPassword(),
  maxRetriesPerRequest: null, // Required for BullMQ
  retryStrategy(times) {
    const delay = Math.min(times * 50, 2000);
    return delay;
  },
});

// Log connection status
redis.on("connect", () => {
  console.log(`✅ Redis connected: ${env.REDIS_HOST}:${env.REDIS_PORT}`);
});

redis.on("error", (error) => {
  console.error("❌ Redis connection error:", error.message);
});

// Graceful shutdown
process.on("SIGTERM", async () => {
  console.log("🔄 Closing Redis connection...");
  await redis.quit();
  console.log("✅ Redis connection closed");
});
