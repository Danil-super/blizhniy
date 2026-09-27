import { isUuid, supabaseRest } from '@/lib/supabase-rest';

export type DeletionRequestStatus = 'requested' | 'in_review' | 'resolved';

type DeletionRequestRow = {
  id: string;
  user_id: string | null;
  status: DeletionRequestStatus;
  requested_at: string;
  review_started_at: string | null;
  resolved_at: string | null;
  resolution: 'fulfilled' | 'partly_retained' | 'declined' | null;
};

export type PublicDeletionRequest = Omit<DeletionRequestRow, 'user_id'>;

const columns = 'id,user_id,status,requested_at,review_started_at,resolved_at,resolution';

function toPublicRequest(row: DeletionRequestRow): PublicDeletionRequest {
  const { user_id: _userId, ...request } = row;
  void _userId;
  return request;
}

export async function getDeletionRequestForUser(userId: string) {
  if (!isUuid(userId)) {
    throw new Error('Invalid user ID');
  }

  const rows = await supabaseRest<DeletionRequestRow[]>(
    `/rest/v1/account_deletion_requests?select=${columns}&user_id=eq.${encodeURIComponent(userId)}&order=requested_at.desc&limit=1`,
  );

  return rows[0] ? toPublicRequest(rows[0]) : null;
}

async function getActiveDeletionRequestForUser(userId: string) {
  const rows = await supabaseRest<DeletionRequestRow[]>(
    `/rest/v1/account_deletion_requests?select=${columns}&user_id=eq.${encodeURIComponent(userId)}&status=in.(requested,in_review)&order=requested_at.desc&limit=1`,
  );

  return rows[0] ? toPublicRequest(rows[0]) : null;
}

export async function requestAccountDeletion(userId: string) {
  if (!isUuid(userId)) {
    throw new Error('Invalid user ID');
  }

  // The partial unique index serializes simultaneous requests while retaining
  // resolved cases so the user can file a new request after an earlier one.
  const active = await getActiveDeletionRequestForUser(userId);
  if (active) return active;

  try {
    const rows = await supabaseRest<DeletionRequestRow[]>(
      `/rest/v1/account_deletion_requests?select=${columns}`,
      { method: 'POST', prefer: 'return=representation', body: { user_id: userId } },
    );

    if (!rows[0]) throw new Error('No deletion request persisted');
    return toPublicRequest(rows[0]);
  } catch (error) {
    // A concurrent request won the unique-index race. Fail on every other
    // error unless a committed active row is now actually visible.
    const duplicate = await getActiveDeletionRequestForUser(userId).catch(() => null);
    if (duplicate) return duplicate;
    throw error;
  }
}

export type AdminDeletionRequest = DeletionRequestRow & { email: string | null };

export const accountDeletionPageSize = 50;

export async function listDeletionRequestsForAdmin(page: number): Promise<{ requests: AdminDeletionRequest[]; hasMore: boolean }> {
  const rows = await supabaseRest<DeletionRequestRow[]>(
    `/rest/v1/account_deletion_requests?select=${columns}&status=in.(requested,in_review)&order=requested_at.asc,id.asc&limit=${accountDeletionPageSize + 1}&offset=${page * accountDeletionPageSize}`,
  );
  const hasMore = rows.length > accountDeletionPageSize;
  const currentPage = rows.slice(0, accountDeletionPageSize);

  if (!currentPage.length) {
    return { requests: [], hasMore };
  }

  const ids = currentPage.map((row) => row.user_id).filter((id): id is string => id !== null);
  const profiles = ids.length ? await supabaseRest<{ id: string; email: string | null }[]>(
    `/rest/v1/profiles?select=id,email&id=in.(${ids.map(encodeURIComponent).join(',')})`,
  ) : [];
  const emailById = new Map(profiles.map((row) => [row.id, row.email]));

  return { requests: currentPage.map((row) => ({ ...row, email: row.user_id ? emailById.get(row.user_id) ?? null : null })), hasMore };
}

export async function startDeletionReview(requestId: string) {
  if (!isUuid(requestId)) {
    return null;
  }

  const rows = await supabaseRest<DeletionRequestRow[]>(
    `/rest/v1/account_deletion_requests?select=${columns}&id=eq.${encodeURIComponent(requestId)}&status=eq.requested`,
    {
      method: 'PATCH',
      prefer: 'return=representation',
      body: { status: 'in_review', review_started_at: new Date().toISOString() },
    },
  );

  return rows[0] ?? null;
}

export type DeletionResolution = 'fulfilled' | 'partly_retained' | 'declined';

export async function resolveDeletionReview(requestId: string, resolution: DeletionResolution, caseReference: string) {
  if (!isUuid(requestId)) {
    return null;
  }

  const rows = await supabaseRest<DeletionRequestRow[]>(
    `/rest/v1/account_deletion_requests?select=${columns}&id=eq.${encodeURIComponent(requestId)}&status=eq.in_review`,
    {
      method: 'PATCH',
      prefer: 'return=representation',
      body: {
        status: 'resolved',
        resolved_at: new Date().toISOString(),
        resolution,
        resolution_note: caseReference,
      },
    },
  );

  return rows[0] ?? null;
}
