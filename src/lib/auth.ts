import jwt, { type SignOptions } from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { env } from "./env.ts";
import fs from "node:fs";
import { type DecodedToken } from "../types/index.ts";

const JWT_SECRET = fs.readFileSync(env.JWT_SECRET_FILE, "utf8").trim();
const JWT_EXPIRATION = (env.JWT_EXPIRATION ||
  "24H") as SignOptions["expiresIn"];

export async function hashPassword(password: string): Promise<string> {
  const saltRounds = 10;
  return bcrypt.hash(password, saltRounds);
}

export async function comparePassword(
  password: string,
  hash: string,
): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export function generateToken(
  userId: string,
  email: string,
  role: "user" | "admin" = "user",
): string {
  return jwt.sign({ userId, email, role }, JWT_SECRET, {
    expiresIn: JWT_EXPIRATION,
  });
}

export function verifyToken(token: string): DecodedToken {
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as DecodedToken;
    return decoded;
  } catch (error) {
    throw new Error("Invalid or expired token");
  }
}
