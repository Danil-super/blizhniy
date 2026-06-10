"use client";

import {
  createDefaultCabinetProfile,
  readCabinetProfile,
  resolveClientUserIdentity,
  type CabinetProfile,
} from "@/lib/client-user-profile";

export type SiteNotificationCategory = "booking" | "message" | "payment" | "publication" | "system" | "security";
export type SiteNotificationTone = "info" | "success" | "warning" | "danger";

export type SiteNotification = {
  id: string;
  category: SiteNotificationCategory;
  title: string;
  message: string;
  createdAt: string;
  read: boolean;
  tone?: SiteNotificationTone;
  actionHref?: string;
  actionLabel?: string;
  dedupeKey?: string;
};

export type AddSiteNotificationInput = Omit<SiteNotification, "createdAt" | "id" | "read"> & {
  createdAt?: string;
  id?: string;
  read?: boolean;
};

export const siteNotificationsEventName = "blizhniy-site-notifications-updated";

export function siteNotificationsStorageKey(ownerKey: string) {
  return `blizhniy-site-notifications:${ownerKey || "local-user"}`;
}

function createNotificationId() {
  return `notice-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function readJsonArray<T>(key: string): T[] {
  try {
    const stored = window.localStorage.getItem(key);
    const parsed = stored ? (JSON.parse(stored) as unknown) : null;
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

export function readSiteNotifications(ownerKey: string) {
  return readJsonArray<SiteNotification>(siteNotificationsStorageKey(ownerKey)).filter(
    (item) => item && typeof item === "object" && typeof item.id === "string",
  );
}

export function writeSiteNotifications(ownerKey: string, items: SiteNotification[]) {
  window.localStorage.setItem(siteNotificationsStorageKey(ownerKey), JSON.stringify(items.slice(0, 120)));
  window.dispatchEvent(new CustomEvent(siteNotificationsEventName, { detail: { ownerKey } }));
}

export function isNotificationCategoryEnabled(profile: CabinetProfile, category: SiteNotificationCategory) {
  if (category === "booking") {
    return profile.notifyBookings;
  }

  if (category === "message") {
    return profile.notifyMessages;
  }

  if (category === "payment") {
    return profile.notifyPayments;
  }

  if (category === "publication") {
    return profile.notifyPublicationStatus;
  }

  return profile.notifySystem;
}

export function addSiteNotification(ownerKey: string, profile: CabinetProfile, input: AddSiteNotificationInput) {
  if (!isNotificationCategoryEnabled(profile, input.category)) {
    return null;
  }

  const currentItems = readSiteNotifications(ownerKey);
  const nextNotification: SiteNotification = {
    ...input,
    id: input.id ?? createNotificationId(),
    createdAt: input.createdAt ?? new Date().toISOString(),
    read: input.read ?? false,
  };
  const filteredItems = input.dedupeKey ? currentItems.filter((item) => item.dedupeKey !== input.dedupeKey) : currentItems;

  writeSiteNotifications(ownerKey, [nextNotification, ...filteredItems]);
  return nextNotification;
}

export async function addCurrentUserNotification(input: AddSiteNotificationInput) {
  const identity = await resolveClientUserIdentity();
  const fallback = createDefaultCabinetProfile(identity);
  const profile = readCabinetProfile(identity.ownerKey, fallback);

  return addSiteNotification(identity.ownerKey, profile, input);
}

export function markSiteNotificationsRead(ownerKey: string) {
  writeSiteNotifications(
    ownerKey,
    readSiteNotifications(ownerKey).map((item) => ({ ...item, read: true })),
  );
}

export function clearSiteNotifications(ownerKey: string) {
  writeSiteNotifications(ownerKey, []);
}
