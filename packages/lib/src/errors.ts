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
  VERSION_CONFLICT: "VERSION_CONFLICT",
  BOOKING_NOT_FOUND: "BOOKING_NOT_FOUND",
  BOOKING_ALREADY_CANCELLED: "BOOKING_ALREADY_CANCELLED",

  // Event errors
  FAILED_TO_CREATE_EVENT: "FAILED_TO_CREATE_EVENT",
  FAILED_TO_CREATE_USER: "FAILED_TO_CREATE_USER",

  // Database timeout errors
  STATEMENT_TIMEOUT: "STATEMENT_TIMEOUT",
  DATABASE_CONNECTION_ERROR: "DATABASE_CONNECTION_ERROR",

  // Unknown/generic errors
  INTERNAL_SERVER_ERROR: "INTERNAL_SERVER_ERROR",
} as const;

// Union type for type-safe error code usage
export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

// Error metadata mapping each error code to HTTP status and message
export const ERROR_METADATA: Record<
  ErrorCode,
  { statusCode: number; message: string }
> = {
  // Authentication errors
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

  // Booking errors
  [ErrorCode.EVENT_NOT_FOUND]: {
    statusCode: 404,
    message: "Event not found",
  },
  [ErrorCode.EVENT_SOLD_OUT]: {
    statusCode: 409,
    message: "Event is sold out",
  },
  [ErrorCode.VERSION_CONFLICT]: {
    statusCode: 409,
    message: "Event was modified by another process. Retrying...",
  },
  [ErrorCode.BOOKING_NOT_FOUND]: {
    statusCode: 404,
    message: "Booking not found",
  },
  [ErrorCode.BOOKING_ALREADY_CANCELLED]: {
    statusCode: 409,
    message: "Booking is already cancelled",
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

  // Database timeout errors
  [ErrorCode.STATEMENT_TIMEOUT]: {
    statusCode: 503,
    message: "High traffic detected. Please try again in a moment.",
  },
  [ErrorCode.DATABASE_CONNECTION_ERROR]: {
    statusCode: 503,
    message: "Database temporarily unavailable. Please try again.",
  },

  // Generic error
  [ErrorCode.INTERNAL_SERVER_ERROR]: {
    statusCode: 500,
    message: "Internal server error",
  },
};

// Custom application error class
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

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, AppError);
    }
  }

  static isAppError(error: unknown): error is AppError {
    return error instanceof AppError;
  }

  getStatusCode(): number {
    return this.statusCode;
  }
}

// Type guard to check if an error is an AppError
export function isAppError(error: unknown): error is AppError {
  return AppError.isAppError(error);
}

// Helper function to check for PostgreSQL unique constraint violation
export function isPostgresUniqueConstraintError(error: unknown): boolean {
  if (typeof error === "object" && error !== null && "code" in error) {
    return error.code === "23505";
  }
  return false;
}

// Check if error is a PostgreSQL statement timeout
export function isPostgresTimeoutError(error: unknown): boolean {
  if (typeof error === "object" && error !== null && "code" in error) {
    return error.code === "57014";
  }
  return false;
}

// Check if error is a PostgreSQL foreign key violation
export function isPostgresForeignKeyViolationError(error: unknown): boolean {
  if (typeof error === "object" && error !== null && "code" in error) {
    return error.code === "23503";
  }
  return false;
}

// Check if error is a connection timeout
export function isConnectionTimeoutError(error: unknown): boolean {
  if (typeof error === "object" && error !== null && "code" in error) {
    return (error as any).code === "ETIMEDOUT";
  }
  return false;
}
