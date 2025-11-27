import { sql } from "@ticket-hive/database";
import type { Event, CreateEventPayload } from "@ticket-hive/types";
import { AppError, ErrorCode } from "@ticket-hive/lib";

type Database = typeof sql;

interface EventService {
  createEvent(payload: CreateEventPayload): Promise<Event>;
  getAllEvents(
    limit?: number,
    offset?: number,
  ): Promise<{ events: Event[]; total: number }>;
  getEventById(eventId: string): Promise<Event | null>;
}

function createEventService(db: Database): EventService {
  return {
    async createEvent(payload: CreateEventPayload): Promise<Event> {
      const eventDate = new Date(payload.eventDate);

      const events = await db<Event[]>`
        INSERT INTO events (name, total_tickets, available_tickets, event_date)
        VALUES (
          ${payload.name},
          ${payload.totalTickets},
          ${payload.totalTickets},
          ${eventDate}
        )
        RETURNING id, name, total_tickets, available_tickets, version, event_date, created_at, updated_at
      `;

      if (events.length === 0) {
        throw new AppError(ErrorCode.FAILED_TO_CREATE_EVENT);
      }


      return events[0]!;
    },

    async getAllEvents(
      limit: number = 10,
      offset: number = 0,
    ): Promise<{
      events: Event[];
      total: number;
    }> {
      // Get total count of events
      const countResult = await db<Array<{ count: number }>>`
        SELECT COUNT(*) as count FROM events
      `;

      const total = countResult[0]?.count || 0;

      // Get paginated events, ordered by event_date descending (upcoming events first)
      const events = await db<Event[]>`
        SELECT id, name, total_tickets, available_tickets, version, event_date, created_at, updated_at
        FROM events
        ORDER BY event_date DESC
        LIMIT ${limit}
        OFFSET ${offset}
      `;

      return { events, total };
    },

    async getEventById(eventId: string): Promise<Event | null> {
      const events = await db<Event[]>`
        SELECT id, name, total_tickets, available_tickets, version, event_date, created_at, updated_at
        FROM events
        WHERE id = ${eventId}
      `;

      const event = events[0];
      return event ?? null;
    },
  };
}

export const eventService = createEventService(sql);
