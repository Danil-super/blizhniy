-- SQL-only prerequisite; do not deploy until server checkout snapshots,
-- RPC integration and audited legacy reconciliation have been reviewed.
-- Provider verification/financial settlement happen BEFORE this short RPC.
alter table public.payments
  add column if not exists purchased_duration_days integer,
  add column if not exists fulfillment_status text not null default 'pending',
  add column if not exists fulfillment_reason text;
alter table public.payments
  add constraint payments_purchased_duration_days_check
    check (purchased_duration_days is null or purchased_duration_days between 1 and 365),
  add constraint payments_fulfillment_status_check
    check (fulfillment_status in ('pending', 'applied', 'blocked')),
  add constraint payments_fulfillment_reason_check check (
    (fulfillment_status in ('pending', 'applied') and fulfillment_reason is null)
    or (fulfillment_status = 'blocked' and fulfillment_reason is not null and fulfillment_reason in (
      'payment_owner_missing', 'unsupported_target_type', 'payment_missing_paid_at',
      'duration_missing', 'target_missing', 'target_owner_mismatch',
      'target_not_eligible', 'entitlement_expired', 'parent_missing',
      'parent_not_eligible', 'target_changed'))
  ),
  add constraint payments_fulfillment_marker_check check (
    (fulfillment_status <> 'applied' or target_applied_at is not null)
    and (fulfillment_status <> 'blocked' or target_applied_at is null)
  );

-- Do not silently grant historical work requests a new paid window.
alter table public.work_requests
  add column if not exists is_paid boolean not null default false,
  add column if not exists expires_at timestamptz;
alter table public.notifications
  add column if not exists payment_id uuid references public.payments(id) on delete set null;
create unique index notifications_payment_event_unique
  on public.notifications (payment_id, event) where payment_id is not null;

-- Extend the existing monotonic guard; do not install a competing trigger.
create or replace function private.preserve_payment_settlement_state()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if old.status = 'refunded'
    or (old.status = 'succeeded' and new.status <> 'refunded') then
    new.status := old.status;
  end if;
  if old.paid_at is not null then
    new.paid_at := old.paid_at;
  elsif old.target_applied_at is not null or old.status in ('succeeded', 'refunded') then
    -- Historical NULL remains unknown; ordinary metadata/stale provider PATCH
    -- must not invent today's date for already-settled legacy financial rows.
    new.paid_at := old.paid_at;
  elsif new.status = 'succeeded' then
    new.paid_at := coalesce(new.paid_at, pg_catalog.statement_timestamp());
  end if;
  if old.purchased_duration_days is not null then
    new.purchased_duration_days := old.purchased_duration_days;
  end if;
  if old.target_applied_at is not null then
    new.target_applied_at := old.target_applied_at;
    new.fulfillment_status := 'applied';
    new.fulfillment_reason := null;
  elsif old.fulfillment_status = 'blocked' then
    new.target_applied_at := old.target_applied_at;
    new.fulfillment_status := old.fulfillment_status;
    new.fulfillment_reason := old.fulfillment_reason;
  elsif old.fulfillment_status = 'applied' then
    new.fulfillment_status := old.fulfillment_status;
    new.fulfillment_reason := old.fulfillment_reason;
  end if;
  return new;
end;
$$;
revoke all on function private.preserve_payment_settlement_state() from public, anon, authenticated;
grant execute on function private.preserve_payment_settlement_state() to service_role;

create function public.apply_payment_fulfillment(
  p_payment_id uuid,
  p_expected_provider_payment_id text
) returns table (
  payment_id uuid,
  financial_status text,
  fulfillment_status text,
  fulfillment_reason text,
  paid_at timestamptz,
  target_applied_at timestamptz,
  applied_now boolean,
  target_status text
) language plpgsql volatile security invoker set search_path = '' as $$
declare
  v_payment public.payments%rowtype;
  v_application public.applications%rowtype;
  v_locked_application public.applications%rowtype;
  v_marquee public.ad_marquee_placements%rowtype;
  v_owner uuid;
  v_status text;
  v_is_paid boolean;
  v_payment_status text;
  v_parent_owner uuid;
  v_parent_title text;
  v_parent_status text;
  v_parent_paid boolean;
  v_parent_expires timestamptz;
  v_parent_found boolean;
  v_reason text;
  v_now timestamptz;
  v_expires timestamptz;
  v_changed_rows bigint;
  v_applied boolean := false;
begin
  select p.* into v_payment from public.payments p where p.id = p_payment_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Payment not found';
  end if;
  if v_payment.provider <> 'yookassa'
    or p_expected_provider_payment_id is null
    or pg_catalog.btrim(p_expected_provider_payment_id) = ''
    or v_payment.provider_payment_id is distinct from p_expected_provider_payment_id then
    raise exception using errcode = '22023', message = 'Payment provider binding mismatch';
  end if;

  <<attempt>>
  begin
    -- Historical markers and terminal outcomes never cause ANY target write.
    if v_payment.target_applied_at is not null
      or v_payment.fulfillment_status in ('applied', 'blocked') then
      exit attempt;
    end if;
    if v_payment.status <> 'succeeded' then exit attempt; end if;
    if v_payment.user_id is null then v_reason := 'payment_owner_missing'; exit attempt; end if;
    if v_payment.target_type not in ('listing', 'vacancy', 'workRequest', 'fair_application', 'application', 'ad_marquee') then
      v_reason := 'unsupported_target_type'; exit attempt;
    end if;
    if v_payment.paid_at is null then v_reason := 'payment_missing_paid_at'; exit attempt; end if;
    if v_payment.target_type in ('listing', 'vacancy', 'workRequest', 'ad_marquee')
      and v_payment.purchased_duration_days is null then
      v_reason := 'duration_missing'; exit attempt;
    end if;

    if v_payment.target_type in ('listing', 'vacancy', 'workRequest') then
      case v_payment.target_type
        when 'listing' then
          select t.author_id, t.status::text, t.is_paid into v_owner, v_status, v_is_paid
          from public.listings t where t.id = v_payment.target_id for update;
        when 'vacancy' then
          select t.author_id, t.status::text, t.is_paid into v_owner, v_status, v_is_paid
          from public.vacancies t where t.id = v_payment.target_id for update;
        when 'workRequest' then
          select t.author_id, t.status::text, t.is_paid into v_owner, v_status, v_is_paid
          from public.work_requests t where t.id = v_payment.target_id for update;
      end case;
      if not found then v_reason := 'target_missing'; exit attempt; end if;
      if v_owner is distinct from v_payment.user_id then v_reason := 'target_owner_mismatch'; exit attempt; end if;
      if v_status <> 'pending_payment' or v_is_paid then v_reason := 'target_not_eligible'; exit attempt; end if;
      v_now := pg_catalog.clock_timestamp();
      v_expires := v_payment.paid_at + v_payment.purchased_duration_days * interval '24 hours';
      if v_expires <= v_now then v_reason := 'entitlement_expired'; exit attempt; end if;
      case v_payment.target_type
        when 'listing' then
          update public.listings t set status = 'published', is_paid = true,
            published_at = v_payment.paid_at, expires_at = v_expires
          where t.id = v_payment.target_id and t.author_id = v_payment.user_id and t.status = 'pending_payment' and not t.is_paid;
        when 'vacancy' then
          update public.vacancies t set status = 'published', is_paid = true,
            published_at = v_payment.paid_at, expires_at = v_expires
          where t.id = v_payment.target_id and t.author_id = v_payment.user_id and t.status = 'pending_payment' and not t.is_paid;
        when 'workRequest' then
          update public.work_requests t set status = 'published', is_paid = true,
            published_at = v_payment.paid_at, expires_at = v_expires
          where t.id = v_payment.target_id and t.author_id = v_payment.user_id and t.status = 'pending_payment' and not t.is_paid;
      end case;
      get diagnostics v_changed_rows = row_count;
      if v_changed_rows <> 1 then v_reason := 'target_changed'; exit attempt; end if;
      v_status := 'published';

    elsif v_payment.target_type = 'fair_application' then
      select t.user_id, t.status::text, t.payment_status::text into v_owner, v_status, v_payment_status
      from public.fair_applications t where t.id = v_payment.target_id for update;
      if not found then v_reason := 'target_missing'; exit attempt; end if;
      if v_owner is distinct from v_payment.user_id then v_reason := 'target_owner_mismatch'; exit attempt; end if;
      if v_status <> 'pending_payment' or v_payment_status in ('succeeded', 'refunded') then
        v_reason := 'target_not_eligible'; exit attempt;
      end if;
      update public.fair_applications t set payment_status = 'succeeded', status = 'published', published_at = v_payment.paid_at
      where t.id = v_payment.target_id and t.user_id = v_payment.user_id and t.status = 'pending_payment'
        and t.payment_status not in ('succeeded', 'refunded');
      get diagnostics v_changed_rows = row_count;
      if v_changed_rows <> 1 then v_reason := 'target_changed'; exit attempt; end if;
      v_status := 'published';

    elsif v_payment.target_type = 'ad_marquee' then
      select t.* into v_marquee from public.ad_marquee_placements t where t.id = v_payment.target_id for update;
      if not found then v_reason := 'target_missing'; exit attempt; end if;
      v_status := v_marquee.status;
      if v_marquee.user_id is distinct from v_payment.user_id then v_reason := 'target_owner_mismatch'; exit attempt; end if;
      if v_status <> 'pending_payment' or v_marquee.approved_at is null
        or v_marquee.payment_status in ('succeeded', 'refunded')
        or (v_marquee.payment_id is not null and v_marquee.payment_id <> v_payment.id) then
        v_reason := 'target_not_eligible'; exit attempt;
      end if;
      update public.ad_marquee_placements t set payment_status = 'succeeded', status = 'paid',
        payment_id = v_payment.id, paid_at = v_payment.paid_at, updated_at = pg_catalog.clock_timestamp()
      where t.id = v_payment.target_id and t.user_id = v_payment.user_id and t.status = 'pending_payment'
        and t.approved_at is not null and t.payment_status not in ('succeeded', 'refunded');
      get diagnostics v_changed_rows = row_count;
      if v_changed_rows <> 1 then v_reason := 'target_changed'; exit attempt; end if;
      -- Queue activation/duration assignment is a separate reviewed operation.
      -- Never acquire queue locks or reset starts_at/ends_at here.
      v_status := 'paid';

    else -- application: parent-before-child ordering also matches FK CASCADE deletion.
      select a.* into v_application from public.applications a where a.id = v_payment.target_id;
      if not found then v_reason := 'target_missing'; exit attempt; end if;
      if v_application.vacancy_id is not null then
        select t.author_id, t.title, t.status::text, t.is_paid, t.expires_at
        into v_parent_owner, v_parent_title, v_parent_status, v_parent_paid, v_parent_expires
        from public.vacancies t where t.id = v_application.vacancy_id for share;
      else
        select t.author_id, t.title, t.status::text, t.is_paid, t.expires_at
        into v_parent_owner, v_parent_title, v_parent_status, v_parent_paid, v_parent_expires
        from public.work_requests t where t.id = v_application.work_request_id for share;
      end if;
      v_parent_found := found;
      if not v_parent_found then v_reason := 'parent_missing'; exit attempt; end if;
      select a.* into v_locked_application from public.applications a where a.id = v_payment.target_id for update;
      if not found then v_reason := 'target_missing'; exit attempt; end if;
      v_status := v_locked_application.status;
      if v_locked_application.applicant_user_id is distinct from v_payment.user_id then
        v_reason := 'target_owner_mismatch'; exit attempt;
      end if;
      if v_locked_application.vacancy_id is distinct from v_application.vacancy_id
        or v_locked_application.work_request_id is distinct from v_application.work_request_id then
        v_reason := 'target_changed'; exit attempt;
      end if;
      if v_status not in ('pending_payment', 'paid') then v_reason := 'target_not_eligible'; exit attempt; end if;
      v_now := pg_catalog.clock_timestamp(); -- evaluated AFTER both row locks, not at RPC start.
      if v_parent_status <> 'published' or not v_parent_paid
        or v_parent_expires is null or v_parent_expires <= v_now
        or v_parent_owner = v_payment.user_id then
        v_reason := 'parent_not_eligible'; exit attempt;
      end if;
      update public.applications a set is_paid = true, status = 'sent',
        sent_at = coalesce(a.sent_at, v_payment.paid_at), updated_at = v_now
      where a.id = v_payment.target_id and a.applicant_user_id = v_payment.user_id and a.status in ('pending_payment', 'paid');
      get diagnostics v_changed_rows = row_count;
      if v_changed_rows <> 1 then v_reason := 'target_changed'; exit attempt; end if;
      insert into public.notifications (payment_id, user_id, event, subject, body)
      values (v_payment.id, v_parent_owner, 'application_paid',
        case when v_locked_application.work_request_id is not null then 'Новый отклик на заказ' else 'Новый отклик на вакансию' end,
        'Исполнитель оплатил и отправил отклик на «' || v_parent_title || '». Откройте раздел «Отклики», чтобы посмотреть анкету и контакты.');
      get diagnostics v_changed_rows = row_count;
      if v_changed_rows <> 1 then
        raise exception using errcode = '40001', message = 'Application fulfillment notification write failed';
      end if;
      -- Do not swallow insertion errors: target + notice + marker must rollback together.
      v_status := 'sent';
    end if;
    v_applied := true;
  end attempt;

  if v_applied then
    update public.payments p set fulfillment_status = 'applied', fulfillment_reason = null,
      target_applied_at = pg_catalog.clock_timestamp()
    where p.id = v_payment.id returning p.* into strict v_payment;
  elsif v_payment.target_applied_at is not null and v_payment.fulfillment_status <> 'applied' then
    -- Selected legacy metadata normalization only; no historical target repair.
    update public.payments p set fulfillment_status = 'applied', fulfillment_reason = null
    where p.id = v_payment.id returning p.* into strict v_payment;
  elsif v_reason is not null then
    update public.payments p set fulfillment_status = 'blocked', fulfillment_reason = v_reason
    where p.id = v_payment.id returning p.* into strict v_payment;
  end if;
  return query select v_payment.id, v_payment.status::text, v_payment.fulfillment_status,
    v_payment.fulfillment_reason, v_payment.paid_at, v_payment.target_applied_at, v_applied, v_status;
end;
$$;

revoke all on function public.apply_payment_fulfillment(uuid, text) from public, anon, authenticated;
grant execute on function public.apply_payment_fulfillment(uuid, text) to service_role;
notify pgrst, 'reload schema';
