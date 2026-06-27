import { defaultAdMarqueeMessages } from "@/lib/ad-marquee";
import { createStoredNotification } from "@/lib/notification-store";
import { isSupabaseRestConfigured, isUuid, supabaseRest } from "@/lib/supabase-rest";
import { getPublicTariffs } from "@/lib/tariff-store";

export const maxActiveAdMarqueePlacements = 5;

export type AdMarqueePlacementStatus = "pending_review" | "pending_payment" | "paid" | "active" | "rejected" | "expired" | "archived";

export type AdMarqueePlacement = {
  id: string;
  userId: string;
  text: string;
  href?: string;
  status: AdMarqueePlacementStatus;
  paymentStatus: "created" | "pending" | "succeeded" | "failed" | "refunded";
  paymentId?: string;
  startsAt?: string;
  endsAt?: string;
  approvedAt?: string;
  paidAt?: string;
  adminComment?: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};

type AdMarqueePlacementRow = {
  admin_comment?: string | null;
  approved_at?: string | null;
  created_at: string;
  ends_at?: string | null;
  href?: string | null;
  id: string;
  paid_at?: string | null;
  payment_id?: string | null;
  payment_status: AdMarqueePlacement["paymentStatus"];
  sort_order: number;
  starts_at?: string | null;
  status: AdMarqueePlacementStatus;
  text: string;
  updated_at: string;
  user_id: string;
};

type CreateAdMarqueePlacementInput = {
  href?: string;
  text: string;
  userId: string;
};

type UpdateAdMarqueePlacementInput = {
  adminComment?: string;
  id: string;
  sortOrder?: number;
  status: "pending_payment" | "rejected" | "archived";
};

function mapPlacement(row: AdMarqueePlacementRow): AdMarqueePlacement {
  return {
    id: row.id,
    userId: row.user_id,
    text: row.text,
    href: row.href ?? undefined,
    status: row.status,
    paymentStatus: row.payment_status,
    paymentId: row.payment_id ?? undefined,
    startsAt: row.starts_at ?? undefined,
    endsAt: row.ends_at ?? undefined,
    approvedAt: row.approved_at ?? undefined,
    paidAt: row.paid_at ?? undefined,
    adminComment: row.admin_comment ?? undefined,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function normalizeText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeHref(value?: string) {
  const href = value?.trim();

  if (!href) {
    return undefined;
  }

  const parsed = new URL(href);

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Ссылка должна начинаться с http:// или https://");
  }

  return parsed.toString();
}

async function getAdMarqueeDurationDays() {
  const tariff = (await getPublicTariffs()).find((item) => item.action === "ad_marquee");
  return tariff?.durationDays && tariff.durationDays > 0 ? tariff.durationDays : 7;
}

async function expireFinishedPlacements() {
  await supabaseRest("/rest/v1/ad_marquee_placements?status=eq.active&ends_at=lt.now()", {
    method: "PATCH",
    prefer: "return=minimal",
    body: {
      status: "expired",
      updated_at: new Date().toISOString(),
    },
  });
}

export async function refreshAdMarqueeQueue() {
  if (!isSupabaseRestConfigured()) {
    return [];
  }

  await expireFinishedPlacements();

  const activeRows = await supabaseRest<Array<Pick<AdMarqueePlacementRow, "id">>>(
    "/rest/v1/ad_marquee_placements?select=id&status=eq.active&ends_at=gt.now()",
  );
  const slots = Math.max(0, maxActiveAdMarqueePlacements - activeRows.length);

  if (slots <= 0) {
    return activeRows;
  }

  const queuedRows = await supabaseRest<Array<Pick<AdMarqueePlacementRow, "id">>>(
    `/rest/v1/ad_marquee_placements?select=id&status=eq.paid&order=sort_order.asc,paid_at.asc,created_at.asc&limit=${slots}`,
  );

  if (!queuedRows.length) {
    return activeRows;
  }

  const now = new Date();
  const endsAt = new Date(now.getTime() + (await getAdMarqueeDurationDays()) * 24 * 60 * 60 * 1000).toISOString();

  await Promise.all(
    queuedRows.map((row) =>
      supabaseRest(`/rest/v1/ad_marquee_placements?id=eq.${encodeURIComponent(row.id)}`, {
        method: "PATCH",
        prefer: "return=minimal",
        body: {
          ends_at: endsAt,
          starts_at: now.toISOString(),
          status: "active",
          updated_at: now.toISOString(),
        },
      }),
    ),
  );

  return [...activeRows, ...queuedRows];
}

export async function listActiveAdMarqueePlacements() {
  if (!isSupabaseRestConfigured()) {
    return [];
  }

  await refreshAdMarqueeQueue();

  const rows = await supabaseRest<AdMarqueePlacementRow[]>(
    "/rest/v1/ad_marquee_placements?select=*&status=eq.active&ends_at=gt.now()&order=sort_order.asc,starts_at.asc",
  );

  return rows.map(mapPlacement);
}

export async function getActiveAdMarqueeMessages() {
  const placements = await listActiveAdMarqueePlacements().catch((error) => {
    if (error && typeof error === "object" && "digest" in error && error.digest === "DYNAMIC_SERVER_USAGE") {
      throw error;
    }

    console.error("Failed to load active ad marquee placements", error);
    return [];
  });
  const messages = placements.map((placement) => placement.text).filter(Boolean);

  return messages.length ? messages : defaultAdMarqueeMessages;
}

export async function createAdMarqueePlacement(input: CreateAdMarqueePlacementInput) {
  const text = normalizeText(input.text);

  if (text.length < 10 || text.length > 140) {
    throw new Error("Текст бегущей строки должен быть от 10 до 140 символов");
  }

  const href = normalizeHref(input.href);
  const rows = await supabaseRest<AdMarqueePlacementRow[]>("/rest/v1/ad_marquee_placements?select=*", {
    method: "POST",
    prefer: "return=representation",
    body: {
      href: href ?? null,
      status: "pending_review",
      text,
      user_id: input.userId,
    },
  });

  return rows[0] ? mapPlacement(rows[0]) : undefined;
}

export async function listAdMarqueePlacementsForUser(userId: string) {
  if (!isSupabaseRestConfigured()) {
    return [];
  }

  await refreshAdMarqueeQueue();

  const rows = await supabaseRest<AdMarqueePlacementRow[]>(
    `/rest/v1/ad_marquee_placements?select=*&user_id=eq.${encodeURIComponent(userId)}&order=created_at.desc`,
  );

  return rows.map(mapPlacement);
}

export async function listAdMarqueePlacementsForAdmin() {
  if (!isSupabaseRestConfigured()) {
    throw new Error("Supabase env is not configured");
  }

  await refreshAdMarqueeQueue();

  const rows = await supabaseRest<AdMarqueePlacementRow[]>("/rest/v1/ad_marquee_placements?select=*&order=created_at.desc");

  return rows.map(mapPlacement);
}

export async function getPayableAdMarqueePlacementForUser(id: string, userId: string) {
  if (!isUuid(id)) {
    return undefined;
  }

  const rows = await supabaseRest<AdMarqueePlacementRow[]>(
    `/rest/v1/ad_marquee_placements?select=*&id=eq.${encodeURIComponent(id)}&user_id=eq.${encodeURIComponent(userId)}&status=eq.pending_payment&limit=1`,
  );

  return rows[0] ? mapPlacement(rows[0]) : undefined;
}

export async function markStoredAdMarqueePlacementPaid(id: string, paymentId?: string) {
  if (!isUuid(id)) {
    return undefined;
  }

  const paidAt = new Date().toISOString();
  const rows = await supabaseRest<AdMarqueePlacementRow[]>(`/rest/v1/ad_marquee_placements?select=*&id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    prefer: "return=representation",
    body: {
      paid_at: paidAt,
      payment_id: paymentId ?? null,
      payment_status: "succeeded",
      status: "paid",
      updated_at: paidAt,
    },
  });

  await refreshAdMarqueeQueue();

  const updatedRows = await supabaseRest<AdMarqueePlacementRow[]>(
    `/rest/v1/ad_marquee_placements?select=*&id=eq.${encodeURIComponent(id)}&limit=1`,
  );

  return updatedRows[0] ? mapPlacement(updatedRows[0]) : rows[0] ? mapPlacement(rows[0]) : undefined;
}

export async function updateAdMarqueePlacementForAdmin(input: UpdateAdMarqueePlacementInput) {
  if (!isUuid(input.id)) {
    return undefined;
  }

  const now = new Date().toISOString();
  const body: Partial<AdMarqueePlacementRow> = {
    admin_comment: input.adminComment?.trim() || null,
    sort_order: input.sortOrder ?? 0,
    status: input.status,
    updated_at: now,
  };

  if (input.status === "pending_payment") {
    body.approved_at = now;
  }

  const rows = await supabaseRest<AdMarqueePlacementRow[]>(`/rest/v1/ad_marquee_placements?select=*&id=eq.${encodeURIComponent(input.id)}`, {
    method: "PATCH",
    prefer: "return=representation",
    body,
  });
  const placement = rows[0] ? mapPlacement(rows[0]) : undefined;

  if (placement?.userId && input.status === "pending_payment") {
    await createStoredNotification({
      body: "Администратор одобрил текст для бегущей строки. Теперь можно оплатить размещение.",
      event: `ad_marquee_approved:${placement.id}`,
      subject: "Бегущая строка одобрена",
      userId: placement.userId,
    });
  }

  if (placement?.userId && input.status === "rejected") {
    await createStoredNotification({
      body: input.adminComment?.trim() || "Администратор отклонил текст для бегущей строки. Отправьте новую заявку с другим текстом.",
      event: `ad_marquee_rejected:${placement.id}`,
      subject: "Бегущая строка отклонена",
      userId: placement.userId,
    });
  }

  await refreshAdMarqueeQueue();

  return placement;
}
