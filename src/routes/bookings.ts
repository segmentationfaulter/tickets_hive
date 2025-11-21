import { Router } from "express";
import { z } from "zod";
import { bookingService } from "../services/bookingService.ts";
import { verifyJWT } from "../middleware/verify-token.ts";
import { eventService } from "../services/eventService.ts";
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
    if (error instanceof z.ZodError) {
      res.status(400).json({
        success: false,
        error: "Validation failed",
        details: error.issues,
      });
      return;
    }

    if (error instanceof Error) {
      if (error.message === "Event not found") {
        res.status(404).json({
          success: false,
          error: "Event not found",
        });
        return;
      }

      if (error.message === "Event is sold out") {
        res.status(409).json({
          success: false,
          error: "Event is sold out",
        });
        return;
      }
    }

    console.error("Create booking error:", error);
    res.status(500).json({
      success: false,
      error: "Internal server error",
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
    if (error instanceof z.ZodError) {
      res.status(400).json({
        success: false,
        error: "Validation failed",
        details: error.issues,
      });
      return;
    }

    if (error instanceof Error) {
      if (error.message === "Booking not found") {
        res.status(404).json({
          success: false,
          error: "Booking not found",
        });
        return;
      }

      if (error.message === "Booking is already cancelled") {
        res.status(409).json({
          success: false,
          error: "Booking is already cancelled",
        });
        return;
      }
    }

    console.error("Cancel booking error:", error);
    res.status(500).json({
      success: false,
      error: "Internal server error",
    });
  }
});

export default router;
