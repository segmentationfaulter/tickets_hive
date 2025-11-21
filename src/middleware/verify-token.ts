import type { Request, Response, NextFunction } from "express";
import { verifyToken } from "../lib/auth.ts";

export function verifyJWT(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      res
        .status(401)
        .json({ error: "Missing or invalid authorization header" });
      return;
    }

    const token = authHeader.slice(7); // Remove "Bearer " prefix
    const decoded = verifyToken(token);

    req.user = decoded;
    next();
  } catch (error) {
    res.status(401).json({ error: "Invalid or expired token" });
  }
}
