import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { updateStoredFairApplicationStatus } from "@/lib/fair-application-store";
import {
  updateFairApplicationStatus,
  updateListingStatus,
  updateSpecialistStatus,
  updateVacancyStatus,
  updateWorkRequestStatus,
} from "@/lib/mock-store";
import { isAdminRequest, isDemoAdminBypassEnabled, isSupabaseServerConfigured } from "@/lib/server-auth";
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
  status?: string;
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

    if (!updated) {
      updateMockPublicationStatus(entityType, id, status);
    }

    revalidateEntityPaths(entityType);

    return NextResponse.json({ ok: true, updated: updated ? "stored" : "mock" });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Publication status update failed" }, { status: 500 });
  }
}
