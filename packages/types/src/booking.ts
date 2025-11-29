export type BookingStatus = "CONFIRMED" | "CANCELLED";

export interface Booking {
  id: string;
  user_id: string;
  event_id: string;
  status: BookingStatus;
  created_at: Date;
  updated_at: Date;
}

export interface BookingResponse {
  bookingId: string;
  eventId: string;
  status: BookingStatus;
  availableTickets: number;
}
