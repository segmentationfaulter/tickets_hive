import fs from "node:fs";
import postgres from "postgres";
import { env } from "./env.ts";

const password = fs.readFileSync(env.POSTGRES_PASSWORD_FILE, "utf8").trim();

const sql = postgres({
  host: env.POSTGRES_HOST,
  port: Number(env.POSTGRES_PORT),
  database: env.POSTGRES_DB,
  username: env.POSTGRES_USER,
  password,
});

export default sql;
