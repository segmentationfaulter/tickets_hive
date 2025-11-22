// Error code constants - Single source of truth for all application errors
// Using const object with string literals instead of enum for Node.js compatibility

export const ErrorCode = {
  // Authentication errors
  INVALID_CREDENTIALS: "INVALID_CREDENTIALS",
  EMAIL_ALREADY_REGISTERED: "EMAIL_ALREADY_REGISTERED",
  INVALID_TOKEN: "INVALID_TOKEN",
  UNAUTHORIZED: "UNAUTHORIZED",

  // Booking errors
  EVENT_NOT_FOUND: "EVENT_NOT_FOUND",
  EVENT_SOLD_OUT: "EVENT_SOLD_OUT",
  BOOKING_NOT_FOUND: "BOOKING_NOT_FOUND",
  BOOKING_ALREADY_CANCELLED: "BOOKING_ALREADY_CANCELLED",
  FAILED_TO_CREATE_BOOKING: "FAILED_TO_CREATE_BOOKING",
  FAILED_TO_CANCEL_BOOKING: "FAILED_TO_CANCEL_BOOKING",

  // Event errors
  FAILED_TO_CREATE_EVENT: "FAILED_TO_CREATE_EVENT",
  FAILED_TO_CREATE_USER: "FAILED_TO_CREATE_USER",

  // Unknown/generic errors
  INTERNAL_SERVER_ERROR: "INTERNAL_SERVER_ERROR",
} as const;

// Union type for type-safe error code usage
export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

/**
 * Error metadata mapping each error code to HTTP status and message
 * This centralized mapping ensures consistency across the application
 */
export const ERROR_METADATA: Record<
  ErrorCode,
  { statusCode: number; message: string }
> = {
  // Authentication errors (400-401 range)
  [ErrorCode.INVALID_CREDENTIALS]: {
    statusCode: 401,
    message: "Invalid email or password",
  },
  [ErrorCode.EMAIL_ALREADY_REGISTERED]: {
    statusCode: 409,
    message: "Email already registered",
  },
  [ErrorCode.INVALID_TOKEN]: {
    statusCode: 401,
    message: "Invalid or expired token",
  },
  [ErrorCode.UNAUTHORIZED]: {
    statusCode: 403,
    message: "Unauthorized access",
  },

  // Booking errors (400-404-409 range)
  [ErrorCode.EVENT_NOT_FOUND]: {
    statusCode: 404,
    message: "Event not found",
  },
  [ErrorCode.EVENT_SOLD_OUT]: {
    statusCode: 409,
    message: "Event is sold out",
  },
  [ErrorCode.BOOKING_NOT_FOUND]: {
    statusCode: 404,
    message: "Booking not found",
  },
  [ErrorCode.BOOKING_ALREADY_CANCELLED]: {
    statusCode: 409,
    message: "Booking is already cancelled",
  },
  [ErrorCode.FAILED_TO_CREATE_BOOKING]: {
    statusCode: 500,
    message: "Failed to create booking",
  },
  [ErrorCode.FAILED_TO_CANCEL_BOOKING]: {
    statusCode: 500,
    message: "Failed to cancel booking",
  },

  // Event errors
  [ErrorCode.FAILED_TO_CREATE_EVENT]: {
    statusCode: 500,
    message: "Failed to create event",
  },
  [ErrorCode.FAILED_TO_CREATE_USER]: {
    statusCode: 500,
    message: "Failed to create user",
  },

  // Generic error
  [ErrorCode.INTERNAL_SERVER_ERROR]: {
    statusCode: 500,
    message: "Internal server error",
  },
};

/**
 * Custom application error class
 * Extends Error with error code and HTTP status code
 * Provides type-safe error handling throughout the application
 */
export class AppError extends Error {
  public code: ErrorCode;
  public statusCode: number;

  constructor(
    code: ErrorCode,
    statusCode: number = ERROR_METADATA[code].statusCode,
    message?: string,
  ) {
    super(message || ERROR_METADATA[code].message);
    this.code = code;
    this.statusCode = statusCode;
    this.name = "AppError";
    // Maintains proper stack trace for where our error was thrown (only available on V8)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, AppError);
    }
  }

  /**
   * Check if an unknown error is an AppError
   */
  static isAppError(error: unknown): error is AppError {
    return error instanceof AppError;
  }

  /**
   * Get the HTTP status code for this error
   */
  getStatusCode(): number {
    return this.statusCode;
  }
}

/**
 * Type guard to check if an error is an AppError
 */
export function isAppError(error: unknown): error is AppError {
  return AppError.isAppError(error);
}

/**
 * Helper function to check for PostgreSQL unique constraint violation
 * Error code 23505 is the standard PostgreSQL error for unique constraint violation
 */
export function isPostgresUniqueConstraintError(error: unknown): boolean {
  if (typeof error === "object" && error !== null && "code" in error) {
    return error.code === "23505";
  }
  return false;
}
