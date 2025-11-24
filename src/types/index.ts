declare global {
  namespace Express {
    interface Request {
      user?: DecodedToken;
    }
  }
}

type UserRole = "user" | "admin";

export interface User {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  password_hash: string;
  created_at: Date;
  updated_at: Date;
}

export interface DecodedToken {
  userId: string;
  email: string;
  role: UserRole;
  iat: number;
  exp: number;
}

export interface Event {
  id: string;
  name: string;
  total_tickets: number;
  available_tickets: number;
  event_date: Date;
  created_at: Date;
  updated_at: Date;
}

export interface RegisterPayload {
  email: string;
  password: string;
  name: string;
}

export interface LoginPayload {
  email: string;
  password: string;
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

export type BookingStatus = "CONFIRMED" | "CANCELLED";

export interface Booking {
  id: string;
  user_id: string;
  event_id: string;
  status: BookingStatus;
  created_at: Date;
  updated_at: Date;
}

export interface CreateBookingPayload {
  eventId: string;
}

export interface BookingResponse {
  bookingId: string;
  eventId: string;
  status: BookingStatus;
  availableTickets: number;
}

export interface CancelBookingPayload {
  reason?: string;
}
