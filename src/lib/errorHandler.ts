import { Response } from "express";
import { z } from "zod";
import {
  isAppError,
  isPostgresTimeoutError,
  isConnectionTimeoutError,
  isPostgresUniqueConstraintError,
  isPostgresForeignKeyViolationError,
  ErrorCode,
  ERROR_METADATA,
} from "./errors.ts";

export interface ErrorResponse {
  success: false;
  error: {
    code: string;
    message: string;
  };
  details?: any;
}

export interface SuccessResponse<T = any> {
  success: true;
  data: T;
  message: string;
}

/**
 * Handles errors and sends appropriate HTTP responses
 * @param error - The caught error
 * @param res - Express response object
 * @param context - Optional context for logging
 */
export function handleError(error: unknown, res: Response, context?: string): void {
  // Category 1: Validation Errors (400 Bad Request)
  if (error instanceof z.ZodError) {
    res.status(400).json({
      success: false,
      error: {
        code: ErrorCode.INVALID_CREDENTIALS,
        message: "Validation failed",
      },
      details: error.issues,
    });
    return;
  }

  // Category 2: Business Logic Errors (AppError - 4xx)
  if (isAppError(error)) {
    res.status(error.getStatusCode()).json({
      success: false,
      error: {
        code: error.code,
        message: error.message,
      },
    });
    return;
  }

  // Category 3a: Database Statement Timeout (503)
  if (isPostgresTimeoutError(error)) {
    res.status(503).json({
      success: false,
      error: {
        code: ErrorCode.STATEMENT_TIMEOUT,
        message: "High traffic detected. Please try again in a moment.",
      },
    });
    return;
  }

  // Category 3b: Database Connection Timeout (503)
  if (isConnectionTimeoutError(error)) {
    res.status(503).json({
      success: false,
      error: {
        code: ErrorCode.DATABASE_CONNECTION_ERROR,
        message: "Service temporarily unavailable. Please try again.",
      },
    });
    return;
  }

  // Category 3c: Unique Constraint Violation (409)
  if (isPostgresUniqueConstraintError(error)) {
    const { statusCode, message } = ERROR_METADATA.EMAIL_ALREADY_REGISTERED;
    res.status(statusCode).json({
      success: false,
      error: {
        code: ErrorCode.EMAIL_ALREADY_REGISTERED,
        message: message,
      },
    });
    return;
  }

  // Category 3d: Foreign Key Violation (404)
  if (isPostgresForeignKeyViolationError(error)) {
    res.status(404).json({
      success: false,
      error: {
        code: ErrorCode.EVENT_NOT_FOUND,
        message: "Resource not found",
      },
    });
    return;
  }

  // Category 4: Unexpected Errors (500 Internal Server Error)
  console.error(`Unexpected error${context ? ` in ${context}` : ""}:`, error);
  res.status(500).json({
    success: false,
    error: {
      code: ErrorCode.INTERNAL_SERVER_ERROR,
      message: "An unexpected error occurred",
    },
  });
}
