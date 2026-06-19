import { isSupabaseRestConfigured, isUuid, supabaseRest } from "@/lib/supabase-rest";
import type { PublicationStatus } from "@/lib/types";

type WorkRequestStatusRow = {
  id: string;
  published_at?: string | null;
  status: PublicationStatus;
};

export async function getStoredWorkRequestForUser(requestId: string, userId: string) {
  if (!isSupabaseRestConfigured() || !isUuid(requestId)) {
    return undefined;
  }

  const rows = await supabaseRest<WorkRequestStatusRow[]>(
    `/rest/v1/work_requests?select=id,status,published_at&id=eq.${encodeURIComponent(requestId)}&author_id=eq.${encodeURIComponent(userId)}&limit=1`,
  );

  return rows[0];
}

export async function markStoredWorkRequestPendingPaymentForUser(requestId: string, userId: string) {
  if (!isSupabaseRestConfigured() || !isUuid(requestId)) {
    return false;
  }

  const rows = await supabaseRest<Array<Pick<WorkRequestStatusRow, "id">>>(
    `/rest/v1/work_requests?select=id&id=eq.${encodeURIComponent(requestId)}&author_id=eq.${encodeURIComponent(userId)}&status=eq.draft`,
    {
      method: "PATCH",
      prefer: "return=representation",
      body: {
        status: "pending_payment",
      },
    },
  );

  return Boolean(rows[0]?.id);
}

export async function markStoredWorkRequestPaid(requestId: string) {
  if (!isSupabaseRestConfigured() || !isUuid(requestId)) {
    return false;
  }

  const now = new Date().toISOString();
  const existingRows = await supabaseRest<WorkRequestStatusRow[]>(
    `/rest/v1/work_requests?select=id,status,published_at&id=eq.${encodeURIComponent(requestId)}&limit=1`,
  );
  const existingRequest = existingRows[0];

  if (!existingRequest) {
    return false;
  }

  if (existingRequest.status === "published") {
    return true;
  }

  if (existingRequest.status === "archived" || existingRequest.status === "expired" || existingRequest.status === "rejected") {
    return true;
  }

  const rows = await supabaseRest<Array<Pick<WorkRequestStatusRow, "id">>>(
    `/rest/v1/work_requests?select=id&id=eq.${encodeURIComponent(requestId)}`,
    {
      method: "PATCH",
      prefer: "return=representation",
      body: {
        published_at: now,
        status: "published",
      },
    },
  );

  return Boolean(rows[0]?.id);
}

export async function deleteStoredWorkRequestForUser(requestId: string, userId: string) {
  if (!isSupabaseRestConfigured() || !isUuid(requestId)) {
    return false;
  }

  const rows = await supabaseRest<Array<Pick<WorkRequestStatusRow, "id">>>(
    `/rest/v1/work_requests?select=id&id=eq.${encodeURIComponent(requestId)}&author_id=eq.${encodeURIComponent(userId)}`,
    {
      method: "DELETE",
      prefer: "return=representation",
    },
  );

  return Boolean(rows[0]?.id);
}
