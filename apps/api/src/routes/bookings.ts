import { Router } from "express";
import { z } from "zod";
import { bookingService } from "../services/bookingService.ts";
import { queueService } from "../services/queueService.ts";
import { handleError, ErrorCode } from "@ticket-hive/lib";
import type {
  Booking,
  BookingJobCreatedResponse,
  BookingJobStatusResponse,
  SuccessResponse,
  ErrorResponse,
} from "@ticket-hive/types";
import { BookingJobSchema } from "@ticket-hive/types";
import { verifyJWT } from "../middleware/verify-token.ts";

const router = Router();

const createBookingSchema = z.object({
  eventId: z.uuid("Event ID must be a valid UUID"),
});

const idParamSchema = z.object({
  id: z.uuid("Invalid booking ID format"),
});

/**
 * POST /api/v1/bookings
 *
 * Async queue-based booking
 * Returns 202 Accepted with jobId for status polling
 */
router.post("/", verifyJWT, async (req, res) => {
  try {
    const userId = req.user!.userId;
    const { eventId } = createBookingSchema.parse(req.body);

    // Validate job data with Zod schema
    const jobData = BookingJobSchema.parse({
      userId,
      eventId,
      timestamp: Date.now(),
    });

    // Create job and return immediately (non-blocking)
    const jobId = await queueService.createBookingJob(jobData);

    // Return 202 Accepted (not 201 Created)
    const response: SuccessResponse<BookingJobCreatedResponse> = {
      success: true,
      data: {
        jobId,
        status: "pending",
      },
      message: `Booking request received. Check status at /api/v1/bookings/status/${jobId}`,
    };

    res.status(202).json(response);
  } catch (error) {
    handleError(error, res, "createBooking");
  }
});

/**
 * GET /api/v1/bookings/status/:jobId
 *
 * Returns job status for polling
 * States: pending, processing, completed, failed
 */
router.get("/status/:jobId", async (req, res) => {
  try {
    const { jobId } = req.params;
    const jobStatus = await queueService.getJobStatus(jobId);

    // Handle not found
    if (jobStatus.status === "not_found") {
      const errorResponse: ErrorResponse = {
        success: false,
        error: {
          code: "JOB_NOT_FOUND",
          message: "Job not found. It may have expired or never existed.",
        },
      };
      return res.status(404).json(errorResponse);
    }

    // Map BullMQ states to user-friendly responses
    const statusMap: Record<string, string> = {
      waiting: "pending",
      delayed: "pending",
      active: "processing",
      completed: "completed",
      failed: "failed",
    };

    const userFriendlyStatus = statusMap[jobStatus.status] || jobStatus.status;

    // Return different responses based on state
    if (jobStatus.status === "completed") {
      const response: SuccessResponse<BookingJobStatusResponse> = {
        success: true,
        data: {
          status: "completed",
          result: {
            bookingId: jobStatus.result!.bookingId,
            eventId: jobStatus.result!.eventId,
            remainingTickets: jobStatus.result!.remainingTickets,
            version: jobStatus.result!.version,
            processedAt: jobStatus.result!.processedAt,
          },
        },
        message: "Booking completed successfully",
      };
      return res.json(response);
    }

    if (jobStatus.status === "failed") {
      const errorResponse: ErrorResponse = {
        success: false,
        error: {
          code: "BOOKING_JOB_FAILED",
          message: jobStatus.failedReason || "Booking could not be completed",
        },
      };
      return res.json(errorResponse);
    }

    // Still processing (pending or active)
    const response: SuccessResponse<BookingJobStatusResponse> = {
      success: true,
      data: {
        status: userFriendlyStatus as "pending" | "processing",
      },
      message: "Your booking is being processed. Please check again in a moment.",
    };
    return res.json(response);
  } catch (error) {
    return handleError(error, res, "getJobStatus");
  }
});

// GET /api/v1/bookings/:id - Get booking details (authenticated users)
router.get("/:id", verifyJWT, async (req, res) => {
  try {
    const { id } = idParamSchema.parse(req.params);

    const booking = await bookingService.getBooking(id);

    if (!booking) {
      const errorResponse: ErrorResponse = {
        success: false,
        error: {
          code: ErrorCode.BOOKING_NOT_FOUND,
          message: "Booking not found",
        },
      };
      res.status(404).json(errorResponse);
      return;
    }

    const response: SuccessResponse<Booking> = {
      success: true,
      data: booking,
      message: "Booking retrieved successfully",
    };

    res.status(200).json(response);
  } catch (error) {
    handleError(error, res, "getBooking");
  }
});

// DELETE /api/v1/bookings/:id - Cancel a booking (authenticated users)
router.delete("/:id", verifyJWT, async (req, res) => {
  try {
    const { id } = idParamSchema.parse(req.params);

    const booking = await bookingService.cancelBooking(id);

    const response: SuccessResponse<{
      id: string;
      status: string;
      updated_at: string;
    }> = {
      success: true,
      data: {
        id: booking.id,
        status: booking.status,
        updated_at: booking.updated_at.toISOString(),
      },
      message: "Booking cancelled successfully",
    };

    res.status(200).json(response);
  } catch (error) {
    handleError(error, res, "cancelBooking");
  }
});

export default router;
