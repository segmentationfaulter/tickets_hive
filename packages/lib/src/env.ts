import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";
import { readFileSync } from "fs";

// Helper function to read value from either secret file or direct environment variable
function readEnvValue(filePath?: string, directValue?: string): string {
  if (filePath && filePath.startsWith("/run/secrets/")) {
    try {
      // In Docker: read from mounted secret file
      return readFileSync(filePath, "utf8").trim();
    } catch (error) {
      console.error(`❌ Failed to read secret file: ${filePath}`);
      console.error(`💡 Solution: Run 'npm run setup' to generate secrets or ensure Docker secrets are properly mounted`);
      throw new Error(`Missing required secret file: ${filePath}. Run 'npm run setup' to generate secrets.`);
    }
  }

  // Locally: use direct value from environment or .env file
  if (directValue) {
    return directValue;
  }

  console.error("❌ Missing required environment configuration");
  console.error("💡 Solution options:");
  console.error("   1. Run 'npm run setup' to generate secrets automatically");
  console.error("   2. Create .env.local file with POSTGRES_PASSWORD, JWT_SECRET, and REDIS_PASSWORD values");
  console.error("   3. Run 'npm run docker:dev' to use Docker mode with auto-generated secrets");
  throw new Error("No secret file or direct value provided. Run 'npm run setup' to generate secrets automatically.");
}

export const env = createEnv({
  server: {
    PORT: z.string().default("3000"),
    POSTGRES_HOST: z.string(),
    POSTGRES_PORT: z.string().default("5432"),
    POSTGRES_DB: z.string(),
    POSTGRES_USER: z.string(),
    POSTGRES_PASSWORD_FILE: z.string().optional(),
    POSTGRES_PASSWORD: z.string().optional(),
    JWT_SECRET_FILE: z.string().optional(),
    JWT_SECRET: z.string().optional(),
    JWT_EXPIRATION: z.string().default("24H"),
    NODE_ENV: z.enum(["development", "production", "test"]).default("development"),

    // Redis configuration
    REDIS_HOST: z.string().default("localhost"),
    REDIS_PORT: z.coerce.number().default(6379),
    REDIS_PASSWORD_FILE: z.string().optional(),
    REDIS_PASSWORD: z.string().optional(),

    // Worker configuration (MVP: simple values)
    WORKER_CONCURRENCY: z.coerce.number().default(3), // Number of jobs a worker can process concurrently
    WORKER_MAX_RETRIES: z.coerce.number().default(3),
    WORKER_RETRY_DELAY_MS: z.coerce.number().default(100),
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
});

// Export convenience getters for sensitive values
// These handle both Docker secrets and local environment variables
// Priority: 1) Secret file (if in Docker), 2) Direct value, 3) Error
export const getPostgresPassword = (): string => {
  return readEnvValue(
    env.POSTGRES_PASSWORD_FILE,
    env.POSTGRES_PASSWORD
  );
};

export const getJwtSecret = (): string => {
  return readEnvValue(
    env.JWT_SECRET_FILE,
    env.JWT_SECRET
  );
};

export const getRedisPassword = (): string => {
  return readEnvValue(
    env.REDIS_PASSWORD_FILE,
    env.REDIS_PASSWORD
  );
};
