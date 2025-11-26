import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { getJwtSecret, env } from "./env.ts";
import { type DecodedToken } from "@ticket-hive/types";
import { AppError, ErrorCode } from "./errors.ts";

const JWT_SECRET = getJwtSecret();
const JWT_EXPIRATION: string = env.JWT_EXPIRATION || "24h";

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
  } as jwt.SignOptions);
}

export function verifyToken(token: string): DecodedToken {
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as DecodedToken;
    return decoded;
  } catch (error) {
    throw new AppError(ErrorCode.INVALID_TOKEN);
  }
}
