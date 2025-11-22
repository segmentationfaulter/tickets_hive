import type { Request, Response, NextFunction } from "express";
import { verifyToken } from "../lib/auth.ts";
import { isAppError } from "../lib/errors.ts";

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
    if (isAppError(error)) {
      res.status(error.getStatusCode()).json({ error: error.message });
    }

    console.error("Error with token verification", error);
    res.status(500).json({ error: "Internal server error" });
  }
}
