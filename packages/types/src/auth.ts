import { z } from "zod";

export type UserRole = "user" | "admin";

export interface User {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  password_hash: string;
  created_at: Date;
  updated_at: Date;
}

export interface DecodedToken {
  userId: string;
  email: string;
  role: UserRole;
  iat: number;
  exp: number;
}

export interface RegisterPayload {
  email: string;
  password: string;
  name: string;
}

export interface LoginPayload {
  email: string;
  password: string;
}

// Extend Express.Request type for JWT middleware
declare global {
  namespace Express {
    interface Request {
      user?: DecodedToken;
    }
  }
}
