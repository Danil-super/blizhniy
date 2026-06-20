import { isSupabaseRestConfigured, isUuid, supabaseRest } from "@/lib/supabase-rest";
import type { SiteNotification } from "@/lib/site-notifications";

type NotificationRow = {
  id: string;
  user_id?: string | null;
  email?: string | null;
  event: string;
  subject: string;
  body: string;
  sent_at?: string | null;
  created_at: string;
};

export type CreateStoredNotificationInput = {
  body: string;
  email?: string;
  event: string;
  subject: string;
  userId?: string;
};

function categoryFromEvent(event: string): SiteNotification["category"] {
  if (event.includes("payment")) {
    return "payment";
  }

  if (event.includes("application")) {
    return "message";
  }

  return "system";
}

function toneFromEvent(event: string): SiteNotification["tone"] {
  if (event.includes("selected") || event.includes("paid")) {
    return "success";
  }

  if (event.includes("rejected")) {
    return "warning";
  }

  return "info";
}

function actionHrefFromEvent(row: NotificationRow) {
  if (row.event.includes("application")) {
    return "/cabinet/otkliki";
  }

  return undefined;
}

export function mapStoredNotification(row: NotificationRow): SiteNotification {
  return {
    id: row.id,
    actionHref: actionHrefFromEvent(row),
    actionLabel: row.event.includes("application") ? "Открыть отклики" : undefined,
    category: categoryFromEvent(row.event),
    createdAt: row.created_at,
    dedupeKey: row.id,
    message: row.body,
    read: Boolean(row.sent_at),
    title: row.subject,
    tone: toneFromEvent(row.event),
  };
}

export async function createStoredNotification(input: CreateStoredNotificationInput) {
  if (!isSupabaseRestConfigured()) {
    return undefined;
  }

  if (!input.userId && !input.email) {
    return undefined;
  }

  const rows = await supabaseRest<NotificationRow[]>("/rest/v1/notifications?select=*", {
    method: "POST",
    prefer: "return=representation",
    body: {
      body: input.body,
      email: input.email ?? null,
      event: input.event,
      subject: input.subject,
      user_id: input.userId && isUuid(input.userId) ? input.userId : null,
    },
  }).catch(() => []);

  return rows[0] ? mapStoredNotification(rows[0]) : undefined;
}

export async function listStoredNotificationsForUser(userId: string) {
  if (!isSupabaseRestConfigured() || !isUuid(userId)) {
    return [];
  }

  const rows = await supabaseRest<NotificationRow[]>(
    `/rest/v1/notifications?select=*&user_id=eq.${encodeURIComponent(userId)}&order=created_at.desc&limit=50`,
  ).catch(() => []);

  return rows.map(mapStoredNotification);
}

export async function markStoredNotificationsRead(userId: string) {
  if (!isSupabaseRestConfigured() || !isUuid(userId)) {
    return [];
  }

  const rows = await supabaseRest<NotificationRow[]>(
    `/rest/v1/notifications?select=*&user_id=eq.${encodeURIComponent(userId)}&sent_at=is.null`,
    {
      method: "PATCH",
      prefer: "return=representation",
      body: {
        sent_at: new Date().toISOString(),
      },
    },
  ).catch(() => []);

  return rows.map(mapStoredNotification);
}
