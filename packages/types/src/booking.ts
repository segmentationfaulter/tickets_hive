export type BookingStatus = "CONFIRMED" | "CANCELLED";

export interface Booking {
  id: string;
  user_id: string;
  event_id: string;
  status: BookingStatus;
  created_at: Date;
  updated_at: Date;
}

/**
 * Booking Job Created Response
 *
 * Response data for POST /api/v1/bookings (Level 3 async)
 * Returned when a booking job is successfully created and queued
 */
export interface BookingJobCreatedResponse {
  jobId: string;
  status: "pending";
}

/**
 * Booking Job Status Response
 *
 * Response data for GET /api/v1/bookings/status/:jobId
 * Returns current job state and result (when completed)
 */
export type BookingJobStatusResponse =
  | {
      status: "pending" | "processing";
    }
  | {
      status: "completed";
      result: {
        bookingId: string;
        eventId: string;
        remainingTickets: number;
        version: number;
        processedAt: string;
      };
    };
