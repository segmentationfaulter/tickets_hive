import { Router } from "express";
import { z } from "zod";
import { bookingService } from "../services/bookingService.ts";
import { verifyJWT } from "../middleware/verify-token.ts";
import { eventService } from "../services/eventService.ts";
import {
  isAppError,
  isPostgresTimeoutError,
  isConnectionTimeoutError,
  isPostgresForeignKeyViolationError,
  ErrorCode,
} from "../lib/errors.ts";
import type { CreateBookingPayload, BookingResponse } from "../types/index.ts";

const router = Router();

const createBookingSchema = z.object({
  eventId: z.uuid("Event ID must be a valid UUID"),
});

const idParamSchema = z.object({
  id: z.uuid("Invalid booking ID format"),
});

// POST /api/v1/bookings - Create a booking (authenticated users)
router.post("/", verifyJWT, async (req, res) => {
  try {
    const payload: CreateBookingPayload = createBookingSchema.parse(req.body);

    const booking = await bookingService.createBooking(
      req.user!.userId,
      payload,
    );

    // Get updated event to return available tickets
    const event = await eventService.getEventById(payload.eventId);

    const response: BookingResponse = {
      bookingId: booking.id,
      eventId: booking.event_id,
      status: booking.status,
      availableTickets: event?.available_tickets ?? 0,
      message: "Booking confirmed successfully",
    };

    res.status(201).json({
      success: true,
      data: response,
    });
  } catch (error) {
    /**
     * Error Handling Strategy for Booking Creation
     *
     * We handle errors in order of specificity, from most specific to most general:
     * 1. Validation errors (Zod) - User provided invalid data format
     * 2. Business logic errors (AppError) - Expected errors from our application
     * 3. Infrastructure errors (Timeouts) - System under stress
     * 4. Unexpected errors - Bugs or unknown issues
     */

    // Category 1: Validation Errors (400 Bad Request)
    // User provided invalid data format (wrong UUID format, missing fields, etc.)
    if (error instanceof z.ZodError) {
      res.status(400).json({
        success: false,
        error: "Validation failed",
        details: error.issues,
      });
      return;
    }

    // Category 2: Business Logic Errors (AppError - 4xx)
    // These are EXPECTED errors from our application logic:
    // - EVENT_NOT_FOUND (404): Event doesn't exist
    // - EVENT_SOLD_OUT (409): No tickets available
    // - INVALID_TOKEN (401): Authentication failed
    // These are part of normal operation and don't indicate system problems
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

    // Category 3a: Infrastructure Error - Database Statement Timeout (503)
    // Occurs when statement_timeout (5s) is exceeded, typically due to:
    // - High contention: Many concurrent requests locking the same event row
    // - Transaction holds FOR UPDATE lock too long
    // - Database under heavy load
    //
    // This is a TEMPORARY condition. Client should retry with exponential backoff.
    // Example: 1000 users trying to book 100 tickets → some will timeout
    //
    // Why 503 Service Unavailable?
    // - Not user's fault (not 4xx)
    // - Temporary condition (not 500 Internal Server Error)
    // - System working as designed, just overloaded
    // - Retry may succeed when load decreases
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

    // Category 3c: Infrastructure Error - Foreign Key Violation (404)
    // Occurs when trying to create a booking for an event that doesn't exist
    // This should be rare since we validate the event exists in the transaction,
    // but could happen if the event is deleted between validation and booking creation
    if (isPostgresForeignKeyViolationError(error)) {
      res.status(404).json({
        success: false,
        error: {
          code: ErrorCode.EVENT_NOT_FOUND,
          message: "Event not found",
        },
      });
      return;
    }

    // Category 3b: Infrastructure Error - Connection Timeout (503)
    // Occurs when can't establish database connection:
    // - Database server down or unreachable
    // - Connection pool exhausted (all 20 connections in use)
    // - Network issues between API and database
    //
    // This indicates a serious system problem. Operations team should be alerted.
    // Client should retry with exponential backoff, but may need manual intervention.
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

    // Category 4: Unexpected Errors (500 Internal Server Error)
    // These should NOT happen and indicate bugs or unhandled edge cases.
    // Log the full error for investigation, but don't expose details to user.
    //
    // Examples:
    // - Unhandled database errors (new constraint violation we didn't anticipate)
    // - Network errors during event fetch
    // - Bugs in our code
    //
    // These should trigger monitoring alerts for investigation.
    console.error("Unexpected error in createBooking:", error);
    res.status(500).json({
      success: false,
      error: {
        code: ErrorCode.INTERNAL_SERVER_ERROR,
        message: "An unexpected error occurred",
      },
    });
  }
});

// GET /api/v1/bookings/:id - Get booking details (authenticated users)
router.get("/:id", verifyJWT, async (req, res) => {
  try {
    const { id } = idParamSchema.parse(req.params);

    const booking = await bookingService.getBooking(id);

    if (!booking) {
      res.status(404).json({
        success: false,
        error: "Booking not found",
      });
      return;
    }

    res.status(200).json({
      success: true,
      data: booking,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({
        success: false,
        error: "Validation failed",
        details: error.issues,
      });
      return;
    }

    if (isAppError(error)) {
      res.status(error.getStatusCode()).json({
        success: false,
        error: error.message,
      });
      return;
    }

    console.error("Get booking error:", error);
    res.status(500).json({
      success: false,
      error: "Internal server error",
    });
  }
});

// DELETE /api/v1/bookings/:id - Cancel a booking (authenticated users)
router.delete("/:id", verifyJWT, async (req, res) => {
  try {
    const { id } = idParamSchema.parse(req.params);

    const booking = await bookingService.cancelBooking(id);

    res.status(200).json({
      success: true,
      data: {
        id: booking.id,
        status: booking.status,
        updated_at: booking.updated_at,
        message: "Booking cancelled successfully",
      },
    });
  } catch (error) {
    // Same error handling strategy as createBooking
    // See detailed comments in POST / endpoint above

    if (error instanceof z.ZodError) {
      res.status(400).json({
        success: false,
        error: "Validation failed",
        details: error.issues,
      });
      return;
    }

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

    console.error("Unexpected error in cancelBooking:", error);
    res.status(500).json({
      success: false,
      error: {
        code: ErrorCode.INTERNAL_SERVER_ERROR,
        message: "An unexpected error occurred",
      },
    });
  }
});

export default router;
