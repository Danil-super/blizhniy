export type BookingRequestStatus = "pending" | "accepted" | "declined";

export type BookingRequest = {
  id: string;
  listingId: string;
  listingTitle: string;
  startDate?: string;
  endDate?: string;
  guests: number;
  total: number;
  status: BookingRequestStatus;
  createdAt: string;
};

export type BookingNotification = {
  id: string;
  requestId?: string;
  recipient: "owner" | "guest";
  title: string;
  message: string;
  createdAt: string;
  read: boolean;
  actionable?: boolean;
};

export const bookingRequestsStorageKey = "blizhniy-booking-requests";
export const bookingNotificationsStorageKey = "blizhniy-booking-notifications";
export const bookingNotificationsEventName = "blizhniy-booking-notifications-updated";
