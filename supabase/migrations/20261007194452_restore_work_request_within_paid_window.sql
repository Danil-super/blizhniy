-- No historical backfill, new entitlement, financial write or queue activation.
-- Legacy inventory/manual decisions are prerequisites for application rollout.
create function public.restore_work_request_within_paid_window(
  p_work_request_id uuid,
  p_owner_id uuid
) returns table (id uuid)
language plpgsql volatile security invoker set search_path = '' as $$
declare
  v_payment_id uuid;
  v_payment_ids uuid[] := array[]::uuid[];
  v_work public.work_requests%rowtype;
  v_now timestamptz;
  v_changed bigint;
begin
  if p_work_request_id is null or p_owner_id is null then return; end if;

  -- Consistent payment -> target lock order with financial settlement.
  -- Lock all eligible candidates, not just a newest/current-tariff guess.
  for v_payment_id in
    select p.id from public.payments p
    where p.user_id = p_owner_id and p.target_type = 'workRequest'
      and p.target_id = p_work_request_id and p.provider = 'yookassa'
      and nullif(pg_catalog.btrim(p.provider_payment_id), '') is not null
      and p.status = 'succeeded' and p.paid_at is not null
      and p.purchased_duration_days between 1 and 365
      and p.target_applied_at is not null and p.fulfillment_status = 'applied'
    order by p.id for share
  loop
    v_payment_ids := pg_catalog.array_append(v_payment_ids, v_payment_id);
  end loop;
  if pg_catalog.cardinality(v_payment_ids) = 0 then return; end if;

  select w.* into v_work from public.work_requests w
    where w.id = p_work_request_id for update;
  if not found then return; end if;
  v_now := pg_catalog.clock_timestamp(); -- AFTER lock waits, never transaction-start time.
  if v_work.author_id is distinct from p_owner_id or v_work.status <> 'archived'
    or not v_work.is_paid or v_work.expires_at is null or v_work.expires_at <= v_now then
    return;
  end if;

  -- Fresh checks of locked payment provenance and the unchanged purchased window.
  if not exists (
    select 1 from public.payments p
    where p.id = any(v_payment_ids) and p.user_id = v_work.author_id
      and p.target_type = 'workRequest' and p.target_id = v_work.id
      and p.provider = 'yookassa' and nullif(pg_catalog.btrim(p.provider_payment_id), '') is not null
      and p.status = 'succeeded' and p.paid_at is not null and p.paid_at <= v_now
      and p.purchased_duration_days between 1 and 365
      and p.target_applied_at is not null and p.fulfillment_status = 'applied'
      and p.paid_at + p.purchased_duration_days * interval '24 hours' = v_work.expires_at
  ) then return; end if;

  update public.work_requests w set status = 'published'
    where w.id = p_work_request_id and w.author_id = p_owner_id and w.status = 'archived'
      and w.is_paid and w.expires_at = v_work.expires_at and w.expires_at > v_now;
  get diagnostics v_changed = row_count;
  if v_changed <> 1 then return; end if;
  return query select p_work_request_id;
end;
$$;
revoke all on function public.restore_work_request_within_paid_window(uuid, uuid) from public, anon, authenticated;
grant execute on function public.restore_work_request_within_paid_window(uuid, uuid) to service_role;
