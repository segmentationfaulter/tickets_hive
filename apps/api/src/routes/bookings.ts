import { Router } from "express";
import { z } from "zod";
import { bookingService } from "../services/bookingService.ts";
import { eventService } from "../services/eventService.ts";
import { handleError, ErrorCode } from "@ticket-hive/lib";
import type {
  CreateBookingPayload,
  BookingResponse,
  Booking,
  SuccessResponse,
} from "@ticket-hive/types";
import { verifyJWT } from "../middleware/verify-token.ts";

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

    const response: SuccessResponse<BookingResponse> = {
      success: true,
      data: {
        bookingId: booking.id,
        eventId: booking.event_id,
        status: booking.status,
        availableTickets: event?.available_tickets ?? 0,
      },
      message: "Booking confirmed successfully",
    };

    res.status(201).json(response);
  } catch (error) {
    handleError(error, res, "createBooking");
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
        error: {
          code: ErrorCode.BOOKING_NOT_FOUND,
          message: "Booking not found",
        },
      });
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
