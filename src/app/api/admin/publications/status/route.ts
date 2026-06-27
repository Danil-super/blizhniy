import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { createStoredNotification } from "@/lib/notification-store";
import { isAdminRequest, isDemoAdminBypassEnabled } from "@/lib/server-auth";
import { isSupabaseRestConfigured, isUuid, supabaseRest } from "@/lib/supabase-rest";
import type { PublicationStatus } from "@/lib/types";

const allowedStatuses: PublicationStatus[] = ["published", "draft", "pending_payment", "archived", "rejected", "expired", "sold"];

const storedTargets = {
  fairApplication: {
    table: "fair_applications",
    paths: ["/admin/fair-applications", "/yarmarka-masterov", "/poisk"],
  },
  listing: {
    table: "listings",
    paths: ["/admin/obyavleniya", "/", "/katalog/[categorySlug]", "/katalog/[categorySlug]/[subcategorySlug]", "/obyavlenie/[slug]", "/poisk"],
  },
  specialist: {
    table: "specialist_profiles",
    paths: ["/admin/specialisty", "/rabota", "/rabota/specialisty", "/rabota/specialisty/[professionSlug]", "/specialist/[slug]", "/poisk"],
  },
  vacancy: {
    table: "vacancies",
    paths: ["/admin/vakansii", "/rabota", "/rabota/vakansii", "/vakansiya/[slug]", "/poisk"],
  },
  workRequest: {
    table: "work_requests",
    paths: ["/admin/zakazy", "/rabota", "/rabota/zakazy/[slug]", "/poisk"],
  },
} as const;

type EntityType = keyof typeof storedTargets;

type StatusPayload = {
  entityType?: string;
  id?: string;
  reason?: string;
  status?: string;
};

type PublicationOwnerRow = {
  author_id?: string | null;
  id: string;
  name?: string | null;
  organization?: string | null;
  participant_name?: string | null;
  title?: string | null;
  user_id?: string | null;
};

type PublicationNotificationDetails = {
  actionHref: string;
  ownerId?: string;
  title: string;
};

const notificationDetailsByEntityType = {
  fairApplication: {
    actionHref: "/cabinet/fair-applications",
    ownerColumn: "user_id",
    select: "id,user_id,participant_name",
    titleColumn: "participant_name",
  },
  listing: {
    actionHref: "/cabinet/obyavleniya",
    ownerColumn: "author_id",
    select: "id,author_id,title",
    titleColumn: "title",
  },
  specialist: {
    actionHref: "/cabinet/specialist",
    ownerColumn: "user_id",
    select: "id,user_id,name",
    titleColumn: "name",
  },
  vacancy: {
    actionHref: "/cabinet/vakansii",
    ownerColumn: "author_id",
    select: "id,author_id,title,organization",
    titleColumn: "title",
  },
  workRequest: {
    actionHref: "/cabinet/zakazy",
    ownerColumn: "author_id",
    select: "id,author_id,title",
    titleColumn: "title",
  },
} as const satisfies Record<EntityType, { actionHref: string; ownerColumn: "author_id" | "user_id"; select: string; titleColumn: keyof PublicationOwnerRow }>;

const publicationTypeLabels: Record<EntityType, string> = {
  fairApplication: "Заявка на ярмарку",
  listing: "Объявление",
  specialist: "Анкета специалиста",
  vacancy: "Вакансия",
  workRequest: "Заказ",
};

const publicationStatusLabels: Record<PublicationStatus, string> = {
  archived: "Архив",
  draft: "Черновик",
  expired: "Истек срок",
  paid: "Оплачен",
  pending_payment: "Ждет оплату",
  published: "Опубликовано",
  rejected: "Отклонено",
  sold: "Продано",
};

async function requireAdmin(request: Request) {
  return isDemoAdminBypassEnabled() || (await isAdminRequest(request));
}

function isEntityType(value: string): value is EntityType {
  return value in storedTargets;
}

function revalidateEntityPaths(entityType: EntityType) {
  for (const path of storedTargets[entityType].paths) {
    if (path.includes("[")) {
      revalidatePath(path, "page");
    } else {
      revalidatePath(path);
    }
  }
}

async function getCurrentPublicationStatus(entityType: EntityType, id: string) {
  if (!isSupabaseRestConfigured()) {
    throw new Error("Supabase env is not configured");
  }

  if (!isUuid(id)) {
    return undefined;
  }

  const rows = await supabaseRest<Array<{ id: string; status: PublicationStatus }>>(
    `/rest/v1/${storedTargets[entityType].table}?select=id,status&id=eq.${encodeURIComponent(id)}&limit=1`,
  );

  return rows[0];
}

async function updateStoredPublicationStatus(entityType: EntityType, id: string, status: PublicationStatus) {
  const current = await getCurrentPublicationStatus(entityType, id);

  if (!current?.id) {
    return { changed: false, updated: false };
  }

  if (current.status === status) {
    return { changed: false, updated: true };
  }

  const body: Record<string, unknown> = { status };

  if (["fairApplication", "listing", "vacancy", "workRequest"].includes(entityType)) {
    body.published_at = status === "published" ? new Date().toISOString() : null;
  }

  const rows = await supabaseRest<Array<{ id: string }>>(`/rest/v1/${storedTargets[entityType].table}?select=id&id=eq.${encodeURIComponent(id)}`, {
    body,
    method: "PATCH",
    prefer: "return=representation",
  });

  return { changed: Boolean(rows[0]?.id), updated: Boolean(rows[0]?.id) };
}

async function getPublicationNotificationDetails(entityType: EntityType, id: string): Promise<PublicationNotificationDetails | undefined> {
  if (!isSupabaseRestConfigured() || !isUuid(id)) {
    return undefined;
  }

  const config = notificationDetailsByEntityType[entityType];
  const rows = await supabaseRest<PublicationOwnerRow[]>(
    `/rest/v1/${storedTargets[entityType].table}?select=${config.select}&id=eq.${encodeURIComponent(id)}&limit=1`,
  ).catch(() => []);
  const row = rows[0];

  if (!row) {
    return undefined;
  }

  return {
    actionHref: config.actionHref,
    ownerId: String(row[config.ownerColumn] ?? "") || undefined,
    title: String(row[config.titleColumn] ?? row.title ?? row.organization ?? row.participant_name ?? publicationTypeLabels[entityType]).trim(),
  };
}

async function notifyPublicationOwner(entityType: EntityType, id: string, status: PublicationStatus, reason: string) {
  const details = await getPublicationNotificationDetails(entityType, id);

  if (!details?.ownerId) {
    return;
  }

  const statusLabel = publicationStatusLabels[status] ?? status;
  const publicationLabel = publicationTypeLabels[entityType];
  const title = details.title ? `${publicationLabel}: ${details.title}` : publicationLabel;
  const reasonText = reason ? ` Причина: ${reason}` : "";

  await createStoredNotification({
    body: `Администратор изменил статус публикации на «${statusLabel}».${reasonText}`,
    event: `publication_status:${entityType}:${id}:${status}`,
    subject: title,
    userId: details.ownerId,
  });
}

export async function POST(request: Request) {
  if (!(await requireAdmin(request))) {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  const payload = (await request.json().catch(() => null)) as StatusPayload | null;
  const entityType = String(payload?.entityType ?? "");
  const id = String(payload?.id ?? "").trim();
  const reason = String(payload?.reason ?? "").trim().slice(0, 1000);
  const status = String(payload?.status ?? "") as PublicationStatus;

  if (!isEntityType(entityType) || !id || !isUuid(id) || !allowedStatuses.includes(status)) {
    return NextResponse.json({ error: "Invalid publication status payload" }, { status: 400 });
  }

  try {
    const result = await updateStoredPublicationStatus(entityType, id, status);

    if (!result.updated) {
      return NextResponse.json({ error: "Publication not found" }, { status: 404 });
    }

    if (result.changed) {
      revalidateEntityPaths(entityType);
      await notifyPublicationOwner(entityType, id, status, reason);
    }

    return NextResponse.json({ changed: result.changed, ok: true, updated: "stored" });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Publication status update failed" }, { status: 500 });
  }
}
