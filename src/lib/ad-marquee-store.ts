import { defaultAdMarqueeMessages } from "@/lib/ad-marquee";
import { createStoredNotification } from "@/lib/notification-store";
import { isSupabaseRestConfigured, isUuid, supabaseRest } from "@/lib/supabase-rest";

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

type AdMarqueeModerationResult = {
  placement: AdMarqueePlacementRow | null;
  changed: boolean;
  outcome: "updated" | "unchanged" | "not_found" | "conflict";
};

export class AdMarqueeTransitionConflictError extends Error {
  constructor() {
    super("Состояние размещения изменилось: этот переход больше недоступен");
    this.name = "AdMarqueeTransitionConflictError";
  }
}

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

export async function refreshAdMarqueeQueue() {
  if (!isSupabaseRestConfigured()) {
    return [];
  }

  return supabaseRest<Array<Pick<AdMarqueePlacementRow, "id">>>("/rest/v1/rpc/reconcile_ad_marquee_queue", {
    method: "POST",
    body: {},
    timeoutMs: 8000,
  });
}

export async function listActiveAdMarqueePlacements(options: { refresh?: boolean; timeoutMs?: number } = {}) {
  if (!isSupabaseRestConfigured()) {
    return [];
  }

  if (options.refresh ?? true) {
    await refreshAdMarqueeQueue();
  }

  const rows = await supabaseRest<AdMarqueePlacementRow[]>(
    "/rest/v1/ad_marquee_placements?select=*&status=eq.active&ends_at=gt.now()&order=sort_order.asc,starts_at.asc",
    { attempts: options.timeoutMs ? 1 : undefined, timeoutMs: options.timeoutMs },
  );

  return rows.map(mapPlacement);
}

export async function getActiveAdMarqueeMessages() {
  const placements = await listActiveAdMarqueePlacements({ refresh: false, timeoutMs: 300 }).catch((error) => {
    if (error && typeof error === "object" && "digest" in error && error.digest === "DYNAMIC_SERVER_USAGE") {
      throw error;
    }

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

export async function updateAdMarqueePlacementForAdmin(input: UpdateAdMarqueePlacementInput) {
  if (!isUuid(input.id)) {
    return undefined;
  }

  const result = await supabaseRest<AdMarqueeModerationResult>("/rest/v1/rpc/moderate_ad_marquee_placement", {
    method: "POST",
    body: {
      p_id: input.id,
      p_status: input.status,
      p_sort_order: input.sortOrder ?? 0,
      p_admin_comment: input.adminComment?.trim() || null,
    },
    timeoutMs: 8000,
  });

  if (result.outcome === "conflict") {
    throw new AdMarqueeTransitionConflictError();
  }
  if (!result.placement) {
    return undefined;
  }
  const placement = mapPlacement(result.placement);

  if (result.changed && placement.userId && input.status === "pending_payment") {
    await createStoredNotification({
      body: "Администратор одобрил текст для бегущей строки. Теперь можно оплатить размещение.",
      event: `ad_marquee_approved:${placement.id}`,
      subject: "Бегущая строка одобрена",
      userId: placement.userId,
    });
  }

  if (result.changed && placement.userId && input.status === "rejected") {
    await createStoredNotification({
      body: input.adminComment?.trim() || "Администратор отклонил текст для бегущей строки. Отправьте новую заявку с другим текстом.",
      event: `ad_marquee_rejected:${placement.id}`,
      subject: "Бегущая строка отклонена",
      userId: placement.userId,
    });
  }

  // Moderation has committed. Never reconcile from inside its target lock.
  await refreshAdMarqueeQueue();

  return placement;
}
