import { Router } from "express";
import { z } from "zod";
import sql from "../lib/db.ts";
import { hashPassword, comparePassword, generateToken } from "../lib/auth.ts";
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

    // Hash password
    const passwordHash = await hashPassword(payload.password);

    // Create user
    const newUser = await sql<User[]>`
      INSERT INTO users (email, password_hash, name)
      VALUES (${payload.email}, ${passwordHash}, ${payload.name})
      RETURNING id, email, name, role, created_at, updated_at
    `;

    if (newUser.length === 0) {
      res.status(500).json({ error: "Failed to create user" });
      return;
    }

    const user = newUser[0];
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
    if (error instanceof Error && "code" in error) {
      const pgError = error as any;
      if (pgError.code === "23505") {
        res.status(409).json({ error: "Email already registered" });
        return;
      }
    }

    console.error("Register error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /auth/login
router.post("/login", async (req, res) => {
  try {
    const payload: LoginPayload = loginSchema.parse(req.body);

    // Find user by email
    const users = await sql<User[]>`
      SELECT * FROM users WHERE email = ${payload.email}
    `;

    if (users.length === 0) {
      res.status(401).json({ error: "Invalid email or password" });
      return;
    }

    const user = users[0];

    // Compare passwords
    const isPasswordValid = await comparePassword(
      payload.password,
      user.password_hash,
    );

    if (!isPasswordValid) {
      res.status(401).json({ error: "Invalid email or password" });
      return;
    }

    const token = generateToken(user.id, user.email, user.role);

    // Return user without password_hash
    const { password_hash, ...userWithoutPassword } = user;

    res.status(200).json({
      user: userWithoutPassword,
      token,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: error.issues });
      return;
    }

    console.error("Login error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
