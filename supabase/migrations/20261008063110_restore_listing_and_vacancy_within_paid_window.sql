-- Preserve the existing owner/is_paid/known-window contract for listings and
-- vacancies. No historical repair, payer gate, financial write or new window.
create function public.restore_listing_within_paid_window(
  p_listing_id uuid,
  p_owner_id uuid
) returns table (id uuid)
language plpgsql volatile security invoker set search_path = '' as $$
declare
  v_listing public.listings%rowtype;
  v_now timestamptz;
  v_changed bigint;
begin
  if p_listing_id is null or p_owner_id is null then return; end if;
  select l.* into v_listing from public.listings l
    where l.id = p_listing_id for update;
  if not found then return; end if;
  v_now := pg_catalog.clock_timestamp(); -- AFTER row-lock waits.
  if v_listing.author_id is distinct from p_owner_id
    or v_listing.status::text not in ('sold', 'archived', 'expired')
    or not v_listing.is_paid or v_listing.expires_at is null
    or v_listing.expires_at <= v_now then return; end if;

  -- published_at is the existing restore/sort timestamp, not a settlement
  -- anchor. The original paid deadline remains exactly unchanged.
  update public.listings l set status = 'published', published_at = v_now
    where l.id = p_listing_id and l.author_id = p_owner_id
      and l.status::text in ('sold', 'archived', 'expired') and l.is_paid
      and l.expires_at = v_listing.expires_at and l.expires_at > v_now;
  get diagnostics v_changed = row_count;
  if v_changed <> 1 then return; end if;
  return query select p_listing_id;
end;
$$;

create function public.restore_vacancy_within_paid_window(
  p_vacancy_id uuid,
  p_owner_id uuid
) returns table (id uuid)
language plpgsql volatile security invoker set search_path = '' as $$
declare
  v_vacancy public.vacancies%rowtype;
  v_now timestamptz;
  v_changed bigint;
begin
  if p_vacancy_id is null or p_owner_id is null then return; end if;
  select v.* into v_vacancy from public.vacancies v
    where v.id = p_vacancy_id for update;
  if not found then return; end if;
  v_now := pg_catalog.clock_timestamp(); -- AFTER row-lock waits.
  if v_vacancy.author_id is distinct from p_owner_id or v_vacancy.status <> 'archived'
    or not v_vacancy.is_paid or v_vacancy.expires_at is null
    or v_vacancy.expires_at <= v_now then return; end if;

  update public.vacancies v set status = 'published', published_at = v_now
    where v.id = p_vacancy_id and v.author_id = p_owner_id and v.status = 'archived'
      and v.is_paid and v.expires_at = v_vacancy.expires_at and v.expires_at > v_now;
  get diagnostics v_changed = row_count;
  if v_changed <> 1 then return; end if;
  return query select p_vacancy_id;
end;
$$;

-- These target-only RPCs never acquire a payment lock after a target lock:
-- settlement keeps its payment -> target ordering without a reverse edge.
revoke all on function public.restore_listing_within_paid_window(uuid, uuid) from public, anon, authenticated;
revoke all on function public.restore_vacancy_within_paid_window(uuid, uuid) from public, anon, authenticated;
grant execute on function public.restore_listing_within_paid_window(uuid, uuid) to service_role;
grant execute on function public.restore_vacancy_within_paid_window(uuid, uuid) to service_role;
notify pgrst, 'reload schema';
