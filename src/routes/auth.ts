import { Router } from "express";
import { z } from "zod";
import { authService } from "../services/authService.ts";
import { generateToken } from "../lib/auth.ts";
import {
  ERROR_METADATA,
  isAppError,
  isPostgresUniqueConstraintError,
} from "../lib/errors.ts";
import type { RegisterPayload, LoginPayload } from "../types/index.ts";

const router = Router();

const registerSchema = z.object({
  email: z.email("Invalid email format"),
  password: z.string().min(6, "Password must be at least 6 characters"),
  name: z.string().min(1, "Name is required"),
});

const loginSchema = z.object({
  email: z.email("Invalid email format"),
  password: z.string().min(1, "Password is required"),
});

// POST /auth/register
router.post("/register", async (req, res) => {
  try {
    const payload: RegisterPayload = registerSchema.parse(req.body);

    const user = await authService.register(payload);
    const token = generateToken(user.id, user.email, user.role);

    res.status(201).json({
      user,
      token,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: error.issues });
      return;
    }

    // Handle PostgreSQL unique constraint violation (error code 23505)
    if (isPostgresUniqueConstraintError(error)) {
      const { statusCode, message } = ERROR_METADATA.EMAIL_ALREADY_REGISTERED;
      res.status(statusCode).json({ error: message });
      return;
    }

    if (isAppError(error)) {
      res.status(error.getStatusCode()).json({ error: error.message });
      return;
    }

    console.error("Register error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /auth/login
router.post("/login", async (req, res) => {
  try {
    const payload: LoginPayload = loginSchema.parse(req.body);

    const user = await authService.login(payload);
    const token = generateToken(user.id, user.email, user.role);

    res.status(200).json({
      user,
      token,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: error.issues });
      return;
    }

    if (isAppError(error)) {
      res.status(error.getStatusCode()).json({ error: error.message });
      return;
    }

    console.error("Login error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
