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

export function clearLegacyBookingStorage(storage: Pick<Storage, "removeItem">) {
  for (const key of [bookingRequestsStorageKey, bookingNotificationsStorageKey]) {
    try {
      storage.removeItem(key);
    } catch {
      // Storage can be disabled by the browser. Still try to remove the other key.
    }
  }
}

export function installLegacyBookingStorageCleanup(
  storage: Pick<Storage, "removeItem">,
  subscribeToAuthChanges: (onChange: () => void) => () => void,
) {
  const clear = () => clearLegacyBookingStorage(storage);
  clear();
  return subscribeToAuthChanges(clear);
}
