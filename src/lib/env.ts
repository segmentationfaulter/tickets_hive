import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const env = createEnv({
  server: {
    PORT: z.string(),
    POSTGRES_HOST: z.string(),
    POSTGRES_PORT: z.string(),
    POSTGRES_DB: z.string(),
    POSTGRES_USER: z.string(),
    POSTGRES_PASSWORD_FILE: z.string(),
    JWT_SECRET_FILE: z.string(),
    JWT_EXPIRATION: z.string().default("24H"),
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
});
