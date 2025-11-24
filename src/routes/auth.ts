import { Router } from "express";
import { z } from "zod";
import { authService } from "../services/authService.ts";
import { generateToken } from "../lib/auth.ts";
import { handleError, type SuccessResponse } from "../lib/errorHandler.ts";
import type { RegisterPayload, LoginPayload, User } from "../types/index.ts";

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

    const response: SuccessResponse<{ user: User; token: string }> = {
      success: true,
      data: { user, token },
      message: "User registered successfully",
    };

    res.status(201).json(response);
  } catch (error) {
    handleError(error, res, "register");
  }
});

// POST /auth/login
router.post("/login", async (req, res) => {
  try {
    const payload: LoginPayload = loginSchema.parse(req.body);

    const user = await authService.login(payload);
    const token = generateToken(user.id, user.email, user.role);

    const response: SuccessResponse<{ user: User; token: string }> = {
      success: true,
      data: { user, token },
      message: "Login successful",
    };

    res.status(200).json(response);
  } catch (error) {
    handleError(error, res, "login");
  }
});

export default router;
