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

  // Event errors
  FAILED_TO_CREATE_EVENT: "FAILED_TO_CREATE_EVENT",
  FAILED_TO_CREATE_USER: "FAILED_TO_CREATE_USER",

  // Database timeout errors (Level 2)
  STATEMENT_TIMEOUT: "STATEMENT_TIMEOUT",
  DATABASE_CONNECTION_ERROR: "DATABASE_CONNECTION_ERROR",

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

/**
 * Check if error is a PostgreSQL statement timeout
 *
 * PostgreSQL error code 57014 means "query_canceled" which occurs when:
 * - A query exceeds the statement_timeout setting
 * - A transaction waits too long for a lock (FOR UPDATE)
 *
 * In our Level 2 implementation:
 * - We set statement_timeout to 5000ms (5 seconds) in db.ts
 * - When a transaction holds a FOR UPDATE lock and other transactions wait >5s, PostgreSQL cancels them
 * - This prevents cascading delays where hundreds of requests wait indefinitely
 *
 * Example scenario:
 * 1. Transaction A acquires FOR UPDATE lock on event row
 * 2. Transaction A is slow (network issue, complex operation, etc.)
 * 3. Transaction B tries to book same event, waits for lock
 * 4. After 5 seconds, PostgreSQL cancels Transaction B with code 57014
 * 5. We catch this and return user-friendly 503 error
 *
 * Why 503 Service Unavailable?
 * - This is a temporary condition caused by high traffic
 * - Client should retry with exponential backoff
 * - Not a 4xx because it's not the user's fault
 * - Not a 500 because the system is working as designed
 *
 * PostgreSQL Error Code Reference: https://www.postgresql.org/docs/current/errcodes-appendix.html
 */
export function isPostgresTimeoutError(error: unknown): boolean {
  if (typeof error === "object" && error !== null && "code" in error) {
    return error.code === "57014";
  }
  return false;
}

/**
 * Check if error is a PostgreSQL foreign key violation
 *
 * PostgreSQL error code 23503 means "foreign_key_violation" which occurs when:
 * - An INSERT or UPDATE references a foreign key that doesn't exist
 * - A DELETE would orphan child records (if foreign key has ON DELETE RESTRICT)
 *
 * In our Level 2 implementation:
 * - We use foreign keys to enforce referential integrity between tables
 * - Example: bookings.event_id references events.id
 * - When creating a booking with non-existent event_id, PostgreSQL throws 23503
 *
 * Example scenario:
 * 1. User tries to book tickets for event_id '123' (doesn't exist in events table)
 * 2. INSERT INTO bookings (user_id, event_id) VALUES ('user456', '123')
 * 3. PostgreSQL detects foreign key violation → throws error with code 23503
 * 4. We catch this and convert to EVENT_NOT_FOUND (user-friendly error)
 *
 * Why convert to EVENT_NOT_FOUND?
 * - User doesn't need to know about database constraints
 * - "Foreign key violation" is technical jargon
 * - "Event not found" clearly communicates the issue
 * - Consistent with our error handling strategy
 *
 * PostgreSQL Error Code Reference: https://www.postgresql.org/docs/current/errcodes-appendix.html
 */
export function isPostgresForeignKeyViolationError(error: unknown): boolean {
  if (typeof error === "object" && error !== null && "code" in error) {
    return error.code === "23503";
  }
  return false;
}

/**
 * Check if error is a connection timeout
 *
 * This occurs during the initial connection phase when:
 * - PostgreSQL server is unreachable (wrong host/port, server down)
 * - Network timeout during TCP handshake
 * - Authentication takes too long
 * - Connection pool is exhausted (all connections in use)
 *
 * In our configuration (db.ts):
 * - We set connect_timeout to 10 seconds
 * - Default would be 30 seconds, but 10s provides faster feedback
 * - Postgres.js throws an error with message containing "CONNECT_TIMEOUT"
 *
 * Example scenarios:
 * 1. Database server crashes → Can't establish TCP connection → CONNECT_TIMEOUT
 * 2. Wrong hostname in env vars → DNS resolution fails → CONNECT_TIMEOUT
 * 3. All 20 pool connections in use + new request arrives → Can't allocate connection → May timeout
 *
 * How this differs from statement_timeout:
 * - connect_timeout: Happens BEFORE executing any query (connection phase)
 * - statement_timeout: Happens DURING query execution (operation phase)
 *
 * Response strategy:
 * - Return 503 Service Unavailable
 * - Suggests system-level problem (database down, network issue)
 * - Client should retry with exponential backoff
 * - Alert operations team if this happens frequently
 */

export function isConnectionTimeoutError(error: unknown): boolean {
  if (typeof error === "object" && error !== null && "code" in error) {
    // We check for the standard Node.js network timeout code
    // https://nodejs.org/api/errors.html#common-system-errors
    return (error as any).code === "ETIMEDOUT";
  }
  return false;
}

/**
 * ============================================================================
 * ERROR CATEGORIES IN TICKETHIVE
 * ============================================================================
 *
 * Understanding the difference between Business Logic and Infrastructure errors
 * is crucial for proper error handling, user experience, and system monitoring.
 *
 * BUSINESS LOGIC ERRORS (4xx - Client Errors)
 * ============================================================================
 * These are EXPECTED errors caused by invalid user requests or business rule violations.
 * They indicate the user did something wrong or tried to do something not allowed.
 *
 * Examples:
 * ┌─────────────────────────┬────────┬──────────────────────────┬─────────────────────────┐
 * │ Error Code              │ Status │ Meaning                  │ User Action             │
 * ├─────────────────────────┼────────┼──────────────────────────┼─────────────────────────┤
 * │ EVENT_NOT_FOUND         │ 404    │ Event doesn't exist      │ Check event ID          │
 * │ EVENT_SOLD_OUT          │ 409    │ No tickets available     │ Try different event     │
 * │ BOOKING_ALREADY_CANCELLED│ 409   │ Already cancelled        │ Don't retry             │
 * │ INVALID_CREDENTIALS     │ 401    │ Wrong email/password     │ Check credentials       │
 * │ EMAIL_ALREADY_REGISTERED│ 409    │ Email taken              │ Use different email     │
 * └─────────────────────────┴────────┴──────────────────────────┴─────────────────────────┘
 *
 * Characteristics:
 * - These are PART OF NORMAL OPERATION
 * - Should NOT trigger alerts
 * - User can fix by changing their request
 * - Should NOT be retried (same request will fail again)
 * - Logged for analytics but not as errors
 *
 * INFRASTRUCTURE ERRORS (5xx - Server Errors)
 * ============================================================================
 * These indicate SYSTEM PROBLEMS - not user mistakes. Something is wrong with
 * the infrastructure (database, network, etc.) or the application itself.
 *
 * Examples:
 * ┌──────────────────────────┬────────┬─────────────────────────┬─────────────────────────┐
 * │ Error Code               │ Status │ Meaning                 │ User Action             │
 * ├──────────────────────────┼────────┼─────────────────────────┼─────────────────────────┤
 * │ STATEMENT_TIMEOUT        │ 503    │ Database overloaded     │ Wait and retry          │
 * │ DATABASE_CONNECTION_ERROR│ 503    │ Can't reach database    │ Wait and retry          │
 * │ INTERNAL_SERVER_ERROR    │ 500    │ Unexpected bug          │ Report issue            │
 * └──────────────────────────┴────────┴─────────────────────────┴─────────────────────────┘
 *
 * Characteristics:
 * - These are EXCEPTIONAL and should be RARE
 * - Should trigger monitoring alerts
 * - Not the user's fault
 * - CAN be retried (may succeed on retry)
 * - Logged as errors for investigation
 * - May indicate need for scaling/optimization
 *
 * TECHNICAL VS USER-FRIENDLY ERROR MESSAGES
 * ============================================================================
 * A key principle: Never expose technical error details to end users.
 *
 * Example 1: Statement Timeout
 * ────────────────────────────────────────────────────────────────────────────
 * ❌ TECHNICAL (Raw PostgreSQL error):
 *    PostgresError: canceling statement due to statement timeout
 *        at Parser.parseErrorMessage (/node_modules/postgres/src/connection.js:791:15)
 *        at Parser.parseMessage (/node_modules/postgres/src/connection.js:654:17)
 *    code: '57014'
 *    position: undefined
 *    routine: 'ProcessInterrupts'
 *
 * ✅ USER-FRIENDLY (Our API response):
 *    {
 *      "success": false,
 *      "error": {
 *        "code": "STATEMENT_TIMEOUT",
 *        "message": "High traffic detected. Please try again in a moment."
 *      }
 *    }
 *
 * Example 2: Event Not Found
 * ────────────────────────────────────────────────────────────────────────────
 * ❌ TECHNICAL:
 *    Error: No rows returned from query: SELECT * FROM events WHERE id = '123e4567-e89b...'
 *        at EventService.getEventById (src/services/eventService.ts:45:11)
 *
 * ✅ USER-FRIENDLY:
 *    {
 *      "success": false,
 *      "error": {
 *        "code": "EVENT_NOT_FOUND",
 *        "message": "Event not found"
 *      }
 *    }
 *
 * Why User-Friendly Messages Are Better:
 * ─────────────────────────────────────────
 * ✅ No scary technical jargon
 * ✅ Tells user what to do next
 * ✅ Doesn't expose system internals (security)
 * ✅ Consistent format across all errors
 * ✅ Easy to translate to other languages
 * ✅ Professional appearance
 * ✅ Beginner-friendly language
 *
 * IMPLEMENTING THIS IN TICKETHIVE
 * ============================================================================
 *
 * Our error handling architecture has three layers:
 *
 * 1. Database Layer (PostgreSQL):
 *    - Throws low-level errors (code 57014, 23505, etc.)
 *    - Technical messages for developers
 *
 * 2. Service Layer (src/services/):
 *    - Catches database errors
 *    - Converts to AppError with business-friendly codes
 *    - Example: code 57014 → let it propagate for route to handle
 *
 * 3. Route Layer (src/routes/):
 *    - Catches AppError and database errors
 *    - Formats as HTTP responses with user-friendly messages
 *    - Maps to appropriate status codes
 *
 * This separation allows each layer to focus on its concern while providing
 * a clean, consistent API to clients.
 *
 * For more details, see the inline documentation in:
 * - src/routes/bookings.ts (error handling examples)
 * - src/services/bookingService.ts (error conversion)
 * - src/lib/db.ts (timeout configuration)
 */
