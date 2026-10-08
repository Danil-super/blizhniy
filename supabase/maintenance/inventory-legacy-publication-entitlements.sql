-- Optional operator inventory, NEVER a migration/backfill or automatic repair.
-- Works before and after entitlement columns exist. Execute only with explicit
-- read-only database approval; no contacts, text, credentials or checkout URLs.
begin isolation level repeatable read read only;
set local search_path = pg_catalog;
set local lock_timeout = '3s';
set local statement_timeout = '30s';

with targets as (
  select 'listing'::text target_type, t.id, t.author_id, t.status::text status,
    to_jsonb(t) ? 'is_paid' has_paid_column, to_jsonb(t) ? 'expires_at' has_expiry_column,
    (to_jsonb(t)->>'is_paid')::boolean stored_is_paid, (to_jsonb(t)->>'expires_at')::timestamptz expires_at
  from public.listings t
  union all
  select 'vacancy', t.id, t.author_id, t.status::text,
    to_jsonb(t) ? 'is_paid', to_jsonb(t) ? 'expires_at',
    (to_jsonb(t)->>'is_paid')::boolean, (to_jsonb(t)->>'expires_at')::timestamptz
  from public.vacancies t
  union all
  select 'workRequest', t.id, t.author_id, t.status::text,
    to_jsonb(t) ? 'is_paid', to_jsonb(t) ? 'expires_at',
    (to_jsonb(t)->>'is_paid')::boolean, (to_jsonb(t)->>'expires_at')::timestamptz
  from public.work_requests t
), observations as (
  select t.*, case when t.expires_at is null then 'unknown'
    when t.expires_at <= transaction_timestamp() then 'known_elapsed' else 'known_future' end window_state,
    coalesce((select jsonb_agg(jsonb_build_object(
      'id', p.id, 'owner_matches', p.user_id = t.author_id, 'provider', p.provider,
      'has_provider_id', nullif(btrim(p.provider_payment_id), '') is not null,
      'financial_status', p.status, 'paid_at', p.paid_at, 'tariff_id', p.tariff_id,
      'purchased_duration_days', (to_jsonb(p)->>'purchased_duration_days')::integer,
      'target_applied_at', to_jsonb(p)->>'target_applied_at',
      'fulfillment_status', to_jsonb(p)->>'fulfillment_status',
      'fulfillment_reason', to_jsonb(p)->>'fulfillment_reason',
      'window_matches_snapshot', case when p.paid_at is not null and t.expires_at is not null
        and (to_jsonb(p)->>'purchased_duration_days')::integer between 1 and 365
        then p.paid_at + (to_jsonb(p)->>'purchased_duration_days')::integer * interval '24 hours' = t.expires_at
        else null end
    ) order by p.id) from public.payments p where p.target_type = t.target_type and p.target_id = t.id), '[]'::jsonb) payments
  from targets t
)
select jsonb_build_object(
  'as_of', transaction_timestamp(), 'read_only', current_setting('transaction_read_only'),
  'manual_decisions_required', true,
  'publications', coalesce(jsonb_agg(jsonb_build_object(
    'target_type', o.target_type, 'id', o.id, 'owner_id', o.author_id, 'status', o.status,
    'has_paid_column', o.has_paid_column, 'has_expiry_column', o.has_expiry_column,
    'stored_is_paid', o.stored_is_paid, 'expires_at', o.expires_at,
    'window_state', o.window_state, 'payments', o.payments
  ) order by o.target_type, o.id), '[]'::jsonb)
) from observations o;

-- Unknown/false storage flags do NOT classify financial failure or waive rights.
-- No current tariff join, publication-date/today anchor, status change or grant.
rollback;
