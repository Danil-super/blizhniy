import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { updateStoredFairApplicationStatus } from "@/lib/fair-application-store";
import { createStoredNotification } from "@/lib/notification-store";
import {
  updateFairApplicationStatus,
  updateListingStatus,
  updateSpecialistStatus,
  updateVacancyStatus,
  updateWorkRequestStatus,
} from "@/lib/mock-store";
import { isAdminRequest, isDemoAdminBypassEnabled, isSupabaseServerConfigured } from "@/lib/server-auth";
import { shouldShowFallbackContent } from "@/lib/runtime-mode";
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
  if (isSupabaseServerConfigured()) {
    return isAdminRequest(request);
  }

  return isDemoAdminBypassEnabled();
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

async function updateStoredPublicationStatus(entityType: EntityType, id: string, status: PublicationStatus) {
  if (!isSupabaseRestConfigured() || !isUuid(id)) {
    return false;
  }

  const body: Record<string, unknown> = { status };

  if (["fairApplication", "listing", "vacancy", "workRequest"].includes(entityType)) {
    body.published_at = status === "published" ? new Date().toISOString() : null;
  }

  await supabaseRest(`/rest/v1/${storedTargets[entityType].table}?id=eq.${encodeURIComponent(id)}`, {
    body,
    method: "PATCH",
    prefer: "return=minimal",
  });

  return true;
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

function updateMockPublicationStatus(entityType: EntityType, id: string, status: PublicationStatus) {
  if (entityType === "listing") {
    updateListingStatus(id, status);
    return;
  }

  if (entityType === "vacancy") {
    updateVacancyStatus(id, status);
    return;
  }

  if (entityType === "specialist") {
    updateSpecialistStatus(id, status);
    return;
  }

  if (entityType === "workRequest") {
    updateWorkRequestStatus(id, status);
    return;
  }

  if (entityType === "fairApplication") {
    updateFairApplicationStatus(id, status);
  }
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

  if (!isEntityType(entityType) || !id || !allowedStatuses.includes(status)) {
    return NextResponse.json({ error: "Invalid publication status payload" }, { status: 400 });
  }

  try {
    let updated = false;

    if (entityType === "fairApplication") {
      updated = await updateStoredFairApplicationStatus(id, status, { adminContext: true });
    }

    if (!updated) {
      updated = await updateStoredPublicationStatus(entityType, id, status);
    }

    if (!updated && shouldShowFallbackContent()) {
      updateMockPublicationStatus(entityType, id, status);
      revalidateEntityPaths(entityType);

      return NextResponse.json({ ok: true, updated: "mock" });
    }

    if (!updated) {
      return NextResponse.json({ error: "Publication not found" }, { status: 404 });
    }

    revalidateEntityPaths(entityType);
    await notifyPublicationOwner(entityType, id, status, reason);

    return NextResponse.json({ ok: true, updated: "stored" });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Publication status update failed" }, { status: 500 });
  }
}
