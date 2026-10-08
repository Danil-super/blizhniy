-- Capacity and moderation are separate from financial fulfillment. Never call
-- either RPC while holding a payment/placement lock in another operation.
begin;

-- Preserve the intentional 20260927 full browser-write revoke. Legitimate
-- creation continues through the owner-authenticated server API/service role.
revoke insert, update, delete on public.ad_marquee_placements from public, anon, authenticated;

create or replace function private.guard_ad_marquee_queue()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if new.status = 'active' or new.starts_at is not null or new.ends_at is not null then
      raise exception 'Activation requires the queue RPC';
    end if;
    return new;
  end if;

  if (old.starts_at is not null or old.ends_at is not null)
    and (new.starts_at is distinct from old.starts_at or new.ends_at is distinct from old.ends_at) then
    raise exception 'Purchased activation interval is immutable';
  end if;
  if old.status in ('paid', 'active', 'expired', 'rejected', 'archived')
    and new.status in ('pending_review', 'pending_payment', 'paid') and new.status <> old.status then
    raise exception 'Marquee status must remain monotonic';
  end if;

  if (new.status = 'active' and old.status <> 'active')
    or new.starts_at is distinct from old.starts_at or new.ends_at is distinct from old.ends_at then
    -- Observe the already-held lock; NEVER acquire it from a row trigger.
    -- Advisory locks are cooperative, not an authorization boundary against a
    -- trusted service-role SQL operator. Browser writes are denied separately.
    if old.status <> 'paid' or old.starts_at is not null or old.ends_at is not null
      or new.status <> 'active' or new.starts_at is null or new.ends_at is null
      or new.ends_at <= new.starts_at or not exists (
        select 1 from pg_catalog.pg_locks l
        where l.locktype = 'advisory' and l.pid = pg_catalog.pg_backend_pid()
          and l.classid = 1112295754::oid and l.objid = 1::oid and l.objsubid = 2
          and l.mode = 'ExclusiveLock' and l.granted
      ) then
      raise exception 'Activation requires the queue RPC';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function private.guard_ad_marquee_queue() from public, anon, authenticated;
grant execute on function private.guard_ad_marquee_queue() to service_role;
drop trigger if exists ad_marquee_queue_guard on public.ad_marquee_placements;
create trigger ad_marquee_queue_guard before insert or update on public.ad_marquee_placements
for each row execute function private.guard_ad_marquee_queue();

create or replace function public.reconcile_ad_marquee_queue()
returns table(id uuid)
language plpgsql security invoker set search_path = '' set lock_timeout = '2s' as $$
declare
  v_candidates uuid[];
  v_targets uuid[];
  v_payments uuid[];
  v_now timestamptz;
  v_slots integer;
  v_row record;
begin
  -- Allocated two-int key: BLIZ namespace / marquee capacity. Constants only.
  perform pg_catalog.pg_advisory_xact_lock(1112295754, 1);

  -- At most five prospective activations. Preselection is only a bounded lock
  -- set, never the final authorization decision. New paid rows wait for the
  -- next reconcile. Invalid rows cannot starve valid rows at the queue head.
  select coalesce(pg_catalog.array_agg(c.id), '{}'::uuid[]) into v_candidates from (
    select t.id from public.ad_marquee_placements t join public.payments p on p.id = t.payment_id
    where t.status = 'paid' and t.starts_at is null and t.ends_at is null and t.approved_at is not null
      and t.payment_status = 'succeeded' and p.status = 'succeeded' and p.provider = 'yookassa'
      and p.user_id = t.user_id and p.target_type = 'ad_marquee' and p.target_id = t.id
      and p.fulfillment_status = 'applied' and p.target_applied_at is not null
      and p.purchased_duration_days between 1 and 365 and p.paid_at is not null and t.paid_at = p.paid_at
    order by t.sort_order, t.paid_at, t.created_at, t.id limit 5
  ) c;

  select coalesce(pg_catalog.array_agg(t.id order by t.id), '{}'::uuid[]) into v_targets
  from public.ad_marquee_placements t where t.status = 'active' or t.id = any(v_candidates);
  select coalesce(pg_catalog.array_agg(distinct t.payment_id order by t.payment_id), '{}'::uuid[]) into v_payments
  from public.ad_marquee_placements t where t.id = any(v_targets) and t.payment_id is not null;

  -- ALL payments before ANY placement, matching financial payment -> target.
  perform p.id from public.payments p where p.id = any(v_payments) order by p.id for share;
  perform t.id from public.ad_marquee_placements t where t.id = any(v_targets) order by t.id for update;
  v_now := pg_catalog.clock_timestamp();

  -- Expire only a complete, matching purchased window. Historical partial or
  -- inconsistent windows remain untouched and conservatively occupy capacity.
  update public.ad_marquee_placements t set status = 'expired', updated_at = v_now
  from public.payments p
  where t.id = any(v_targets) and t.status = 'active' and p.id = t.payment_id and p.id = any(v_payments)
    and p.user_id = t.user_id and p.target_type = 'ad_marquee' and p.target_id = t.id
    and p.purchased_duration_days between 1 and 365 and t.starts_at is not null
    and t.ends_at = t.starts_at + p.purchased_duration_days * interval '24 hours' and t.ends_at <= v_now;

  select greatest(0, 5 - count(*)::integer) into v_slots
  from public.ad_marquee_placements t where t.status = 'active';

  for v_row in
    select t.id, p.purchased_duration_days
    from public.ad_marquee_placements t join public.payments p on p.id = t.payment_id
    where t.id = any(v_candidates) and p.id = any(v_payments) and t.status = 'paid'
      and t.starts_at is null and t.ends_at is null and t.approved_at is not null
      and t.payment_status = 'succeeded' and p.status = 'succeeded' and p.provider = 'yookassa'
      and p.user_id = t.user_id and p.target_type = 'ad_marquee' and p.target_id = t.id
      and p.fulfillment_status = 'applied' and p.target_applied_at is not null
      and p.purchased_duration_days between 1 and 365 and p.paid_at is not null and t.paid_at = p.paid_at
    order by t.sort_order, t.paid_at, t.created_at, t.id limit v_slots
  loop
    update public.ad_marquee_placements t set status = 'active', starts_at = v_now,
      ends_at = v_now + v_row.purchased_duration_days * interval '24 hours', updated_at = v_now
    where t.id = v_row.id;
  end loop;

  return query select t.id from public.ad_marquee_placements t
  where t.status = 'active' and t.ends_at > v_now order by t.sort_order, t.starts_at, t.id;
end;
$$;
revoke all on function public.reconcile_ad_marquee_queue() from public, anon, authenticated;
grant execute on function public.reconcile_ad_marquee_queue() to service_role;

create or replace function public.moderate_ad_marquee_placement(
  p_id uuid, p_status text, p_sort_order integer, p_admin_comment text
)
returns jsonb
language plpgsql security invoker set search_path = '' set lock_timeout = '2s' as $$
declare
  v_row public.ad_marquee_placements%rowtype;
  v_changed boolean := false;
  v_now timestamptz;
begin
  if p_status is null or p_status not in ('pending_payment', 'rejected', 'archived')
    or p_sort_order is null or pg_catalog.char_length(p_admin_comment) > 2000 then
    raise exception 'Invalid marquee moderation input';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(1112295754, 1);
  select t.* into v_row from public.ad_marquee_placements t where t.id = p_id for update;
  if not found then
    return pg_catalog.jsonb_build_object('placement', null, 'changed', false, 'outcome', 'not_found');
  end if;
  -- This RPC never locks payments or calls reconcile while holding a target.
  if (p_status = 'pending_payment' and v_row.status not in ('pending_review', 'pending_payment'))
    or (p_status = 'rejected' and v_row.status not in ('pending_review', 'pending_payment', 'rejected')) then
    return pg_catalog.jsonb_build_object('placement', pg_catalog.to_jsonb(v_row), 'changed', false, 'outcome', 'conflict');
  end if;

  v_changed := v_row.status <> p_status;
  if v_changed or v_row.sort_order is distinct from p_sort_order
    or v_row.admin_comment is distinct from nullif(pg_catalog.btrim(p_admin_comment), '') then
    v_now := pg_catalog.clock_timestamp();
    update public.ad_marquee_placements t set status = p_status, sort_order = p_sort_order,
      admin_comment = nullif(pg_catalog.btrim(p_admin_comment), ''), updated_at = v_now,
      approved_at = case when p_status = 'pending_payment' then coalesce(t.approved_at, v_now) else t.approved_at end
    where t.id = p_id returning t.* into v_row;
  end if;
  return pg_catalog.jsonb_build_object('placement', pg_catalog.to_jsonb(v_row), 'changed', v_changed,
    'outcome', case when v_changed then 'updated' else 'unchanged' end);
end;
$$;
revoke all on function public.moderate_ad_marquee_placement(uuid,text,integer,text) from public, anon, authenticated;
grant execute on function public.moderate_ad_marquee_placement(uuid,text,integer,text) to service_role;

commit;
