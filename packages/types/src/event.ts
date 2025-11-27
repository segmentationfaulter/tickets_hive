export interface Event {
  id: string;
  name: string;
  total_tickets: number;
  available_tickets: number;
  version: number;
  event_date: Date;
  created_at: Date;
  updated_at: Date;
}

export interface CreateEventPayload {
  name: string;
  totalTickets: number;
  eventDate: string; // ISO 8601 format
}

export interface EventResponse {
  events: Event[];
  total: number;
  limit: number;
  offset: number;
}