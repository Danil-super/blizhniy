import { isUuid, supabaseRest } from '@/lib/supabase-rest';

export type DeletionRequestStatus = 'requested' | 'in_review' | 'resolved';

type DeletionRequestRow = {
  id: string;
  user_id: string;
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
    `/rest/v1/account_deletion_requests?select=${columns}&user_id=eq.${encodeURIComponent(userId)}&limit=1`,
  );

  return rows[0] ? toPublicRequest(rows[0]) : null;
}

export async function requestAccountDeletion(userId: string) {
  if (!isUuid(userId)) {
    throw new Error('Invalid user ID');
  }

  // Unique user_id plus ignore-duplicates makes concurrent clicks and retries
  // idempotent; no client-controlled identifier, email or free-text is saved.
  const rows = await supabaseRest<DeletionRequestRow[]>(
    `/rest/v1/account_deletion_requests?on_conflict=user_id&select=${columns}`,
    {
      method: 'POST',
      prefer: 'resolution=ignore-duplicates,return=representation',
      body: { user_id: userId },
    },
  );

  return rows[0] ? toPublicRequest(rows[0]) : await getDeletionRequestForUser(userId);
}

export type AdminDeletionRequest = DeletionRequestRow & { email: string | null };

export async function listDeletionRequestsForAdmin(): Promise<AdminDeletionRequest[]> {
  const rows = await supabaseRest<DeletionRequestRow[]>(
    `/rest/v1/account_deletion_requests?select=${columns}&status=in.(requested,in_review)&order=requested_at.asc&limit=100`,
  );

  if (!rows.length) {
    return [];
  }

  const ids = rows.map((row) => row.user_id);
  const profiles = await supabaseRest<{ id: string; email: string | null }[]>(
    `/rest/v1/profiles?select=id,email&id=in.(${ids.map(encodeURIComponent).join(',')})`,
  );
  const emailById = new Map(profiles.map((row) => [row.id, row.email]));

  return rows.map((row) => ({ ...row, email: emailById.get(row.user_id) ?? null }));
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
