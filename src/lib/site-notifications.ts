"use client";

import {
  readCabinetProfile,
  resolveClientUserIdentity,
  type CabinetProfile,
} from "@/lib/client-user-profile";
import { shouldShowClientFallbackContent } from "@/lib/client-runtime-mode";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";

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
  bookingRequestId?: string;
  dedupeKey?: string;
};

export type AddSiteNotificationInput = Omit<SiteNotification, "createdAt" | "id" | "read"> & {
  createdAt?: string;
  id?: string;
  read?: boolean;
};

export const siteNotificationsEventName = "blizhniy-site-notifications-updated";
const storagePrefix = "blizhniy-site-notifications:";
const notificationMemory = new Map<string, SiteNotification[]>();
let authCleanupInitialized = false;

export function siteNotificationsStorageKey(ownerKey: string) {
  return `${storagePrefix}${ownerKey || "local-user"}`;
}

function removePersistedNotifications() {
  try {
    for (let index = window.localStorage.length - 1; index >= 0; index -= 1) {
      const key = window.localStorage.key(index);
      if (key?.startsWith(storagePrefix)) window.localStorage.removeItem(key);
    }
  } catch {
    // Storage may be disabled. In-memory notifications remain owner scoped.
  }
}

function ensurePrivateNotificationStorage() {
  if (shouldShowClientFallbackContent() || authCleanupInitialized) return;
  authCleanupInitialized = true;
  removePersistedNotifications();

  try {
    getSupabaseBrowserClient().auth.onAuthStateChange((event) => {
      if (event === "INITIAL_SESSION") return;
      notificationMemory.clear();
      removePersistedNotifications();
      window.setTimeout(() => window.dispatchEvent(new Event(siteNotificationsEventName)), 0);
    });
  } catch {
    // A configured Auth client is unavailable in local builds.
  }
}

if (typeof window !== "undefined") ensurePrivateNotificationStorage();

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
  ensurePrivateNotificationStorage();
  const items = shouldShowClientFallbackContent()
    ? readJsonArray<SiteNotification>(siteNotificationsStorageKey(ownerKey))
    : notificationMemory.get(ownerKey) ?? [];
  return items.filter(
    (item) => item && typeof item === "object" && typeof item.id === "string",
  );
}

export function writeSiteNotifications(ownerKey: string, items: SiteNotification[]) {
  ensurePrivateNotificationStorage();
  if (shouldShowClientFallbackContent()) {
    window.localStorage.setItem(siteNotificationsStorageKey(ownerKey), JSON.stringify(items.slice(0, 120)));
  } else {
    notificationMemory.set(ownerKey, items.slice(0, 120));
  }
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
  try {
    const identity = await resolveClientUserIdentity();
    const profile = await readCabinetProfile(identity);
    if ((await resolveClientUserIdentity()).ownerKey !== identity.ownerKey) return null;
    return addSiteNotification(identity.ownerKey, profile, input);
  } catch {
    // Notifications are optional; a failing profile request must not produce
    // an unhandled promise rejection or write to the wrong account's key.
    return null;
  }
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
