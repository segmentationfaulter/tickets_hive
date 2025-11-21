import { Router } from "express";
import { z } from "zod";
import { eventService } from "../services/eventService.ts";
import { verifyJWT } from "../middleware/verify-token.ts";
import { requireAdmin } from "../middleware/require-admin.ts";
import type { CreateEventPayload, EventResponse } from "../types/index.ts";

const router = Router();

const createEventSchema = z.object({
  name: z.string().min(1, "Event name is required"),
  totalTickets: z
    .number()
    .int()
    .positive("Total tickets must be a positive number"),
  eventDate: z.iso.datetime("Event date must be a valid ISO 8601 datetime"),
});

const paginationSchema = z.object({
  limit: z.coerce.number().int().positive().max(100).default(10).optional(),
  offset: z.coerce.number().int().nonnegative().default(0).optional(),
});

const idParamSchema = z.object({
  id: z.uuid("Invalid event ID format"),
});

// POST /api/v1/events - Create a new event (admin only)
router.post("/", verifyJWT, requireAdmin, async (req, res) => {
  try {
    const payload: CreateEventPayload = createEventSchema.parse(req.body);

    const event = await eventService.createEvent(payload);

    res.status(201).json({
      success: true,
      data: event,
      message: "Event created successfully",
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

    console.error("Create event error:", error);
    res.status(500).json({
      success: false,
      error: "Internal server error",
    });
  }
});

// GET /api/v1/events - List all events with pagination
router.get("/", async (req, res) => {
  try {
    const queryParams = paginationSchema.parse({
      limit: req.query.limit,
      offset: req.query.offset,
    });

    const limit = queryParams.limit ?? 10;
    const offset = queryParams.offset ?? 0;

    const { events, total } = await eventService.getAllEvents(limit, offset);

    const response: EventResponse = {
      events,
      total,
      limit,
      offset,
    };

    res.status(200).json({
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

    console.error("Get events error:", error);
    res.status(500).json({
      success: false,
      error: "Internal server error",
    });
  }
});

// GET /api/v1/events/:id - Get a specific event
router.get("/:id", async (req, res) => {
  try {
    const { id } = idParamSchema.parse(req.params);

    const event = await eventService.getEventById(id);

    if (!event) {
      res.status(404).json({
        success: false,
        error: "Event not found",
      });
      return;
    }

    res.status(200).json({
      success: true,
      data: event,
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

    console.error("Get event error:", error);
    res.status(500).json({
      success: false,
      error: "Internal server error",
    });
  }
});

export default router;
