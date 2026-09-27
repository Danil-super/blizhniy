-- Private intake for verified account deletion requests. Actual erasure needs
-- human review of paid services, retention grounds, foreign keys and backups.
create table public.account_deletion_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete restrict,
  status text not null default 'requested'
    check (status in ('requested', 'in_review', 'resolved')),
  requested_at timestamptz not null default now(),
  review_started_at timestamptz,
  resolved_at timestamptz,
  resolution text check (resolution in ('fulfilled', 'partly_retained', 'declined')),
  resolution_note text,
  constraint account_deletion_resolution_consistent check (
    (status = 'resolved' and resolved_at is not null and resolution is not null and nullif(btrim(resolution_note), '') is not null)
    or
    (status <> 'resolved' and resolved_at is null and resolution is null and resolution_note is null)
  )
);

create index account_deletion_requests_queue_idx
  on public.account_deletion_requests (status, requested_at);

-- Keep past resolutions, while a user can have only one pending review.
create unique index account_deletion_requests_one_active_per_user_idx
  on public.account_deletion_requests (user_id)
  where status in ('requested', 'in_review');

create index account_deletion_requests_user_history_idx
  on public.account_deletion_requests (user_id, requested_at desc);

alter table public.account_deletion_requests enable row level security;

-- No client or anonymous grants/policies: all access goes through server routes
-- with a verified Auth user or separately checked administrator.
revoke all on table public.account_deletion_requests from public, anon, authenticated;
grant select, insert, update on table public.account_deletion_requests to service_role;

comment on table public.account_deletion_requests is
  'Private intake and manual review of account erasure requests; never auto-deletes auth or financial records.';

do $verify_privileges$
begin
  if not (select relrowsecurity from pg_class where oid = 'public.account_deletion_requests'::regclass)
    or has_table_privilege('anon', 'public.account_deletion_requests', 'SELECT')
    or has_table_privilege('authenticated', 'public.account_deletion_requests', 'SELECT')
    or has_table_privilege('authenticated', 'public.account_deletion_requests', 'INSERT')
    or has_table_privilege('authenticated', 'public.account_deletion_requests', 'UPDATE')
    or not has_table_privilege('service_role', 'public.account_deletion_requests', 'INSERT')
  then
    raise exception 'account deletion request table privilege assertions failed';
  end if;
end
$verify_privileges$;
