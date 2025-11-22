import sql from "../lib/db.ts";
import { hashPassword, comparePassword } from "../lib/auth.ts";
import type { RegisterPayload, LoginPayload, User } from "../types/index.ts";
import { AppError, ErrorCode } from "../lib/errors.ts";

type Database = typeof sql;

interface AuthService {
  register(payload: RegisterPayload): Promise<User>;
  login(payload: LoginPayload): Promise<User>;
}

function createAuthService(db: Database): AuthService {
  return {
    async register(payload: RegisterPayload): Promise<User> {
      // Hash password
      const passwordHash = await hashPassword(payload.password);

      // Create user
      const newUser = await db<User[]>`
        INSERT INTO users (email, password_hash, name)
        VALUES (${payload.email}, ${passwordHash}, ${payload.name})
        RETURNING id, email, name, role, created_at, updated_at
      `;

      if (newUser.length === 0) {
        throw new AppError(ErrorCode.FAILED_TO_CREATE_USER);
      }

      return newUser[0];
    },

    async login(payload: LoginPayload): Promise<User> {
      // Find user by email
      const users = await db<User[]>`
        SELECT * FROM users WHERE email = ${payload.email}
      `;

      if (users.length === 0) {
        throw new AppError(ErrorCode.INVALID_CREDENTIALS);
      }

      const user = users[0];

      // Compare passwords
      const isPasswordValid = await comparePassword(
        payload.password,
        user.password_hash,
      );

      if (!isPasswordValid) {
        throw new AppError(ErrorCode.INVALID_CREDENTIALS);
      }

      // Return user without password_hash
      const { password_hash, ...userWithoutPassword } = user;

      return userWithoutPassword as User;
    },
  };
}

export const authService = createAuthService(sql);
