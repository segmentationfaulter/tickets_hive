import { Router } from "express";
import { z } from "zod";
import { eventService } from "../services/eventService.ts";
import { handleError } from "@ticket-hive/lib";
import { ErrorCode } from "@ticket-hive/lib";
import type {
  CreateEventPayload,
  EventResponse,
  Event,
  SuccessResponse,
  ErrorResponse,
} from "@ticket-hive/types";
import { verifyJWT } from "../middleware/verify-token.ts";
import { requireAdmin } from "../middleware/require-admin.ts";

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

    const response: SuccessResponse<Event> = {
      success: true,
      data: event,
      message: "Event created successfully",
    };

    res.status(201).json(response);
  } catch (error) {
    handleError(error, res, "createEvent");
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

    const response: SuccessResponse<EventResponse> = {
      success: true,
      data: {
        events,
        total,
        limit,
        offset,
      },
      message: "Events retrieved successfully",
    };

    res.status(200).json(response);
  } catch (error) {
    handleError(error, res, "getEvents");
  }
});

// GET /api/v1/events/:id - Get a specific event
router.get("/:id", async (req, res) => {
  try {
    const { id } = idParamSchema.parse(req.params);

    const event = await eventService.getEventById(id);

    if (!event) {
      const errorResponse: ErrorResponse = {
        success: false,
        error: {
          code: ErrorCode.EVENT_NOT_FOUND,
          message: "Event not found",
        },
      };
      res.status(404).json(errorResponse);
      return;
    }

    const response: SuccessResponse<Event> = {
      success: true,
      data: event,
      message: "Event retrieved successfully",
    };

    res.status(200).json(response);
  } catch (error) {
    handleError(error, res, "getEventById");
  }
});

export default router;
