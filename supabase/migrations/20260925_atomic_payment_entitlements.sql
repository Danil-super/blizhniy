-- Atomic fulfillment of provider-confirmed payments. Deploy together with payment-provider.ts.
-- Existing published specialist profiles without a matching YooKassa payment become drafts.
-- Review the three affected legacy profiles with the owner before applying this migration.
alter table public.payments
  add column if not exists duration_days integer,
  add column if not exists confirmation_url text,
  add column if not exists applied_at timestamptz;

update public.payments p
set duration_days = t.duration_days
from public.tariffs t
where p.tariff_id = t.id and p.duration_days is null;

alter table public.payments
  add constraint payments_duration_days_positive check (duration_days is null or duration_days > 0);

create unique index if not exists payments_provider_reference_unique
  on public.payments (provider, provider_payment_id)
  where provider_payment_id is not null;

-- One reservation per target. Reserve locally before calling YooKassa; the payment
-- UUID becomes the provider's Idempotence-Key, shared by concurrent app workers.
create unique index if not exists payments_one_open_yookassa_target
  on public.payments (target_type, target_id)
  where provider = 'yookassa' and status in ('created', 'pending');

alter table public.specialist_profiles
  add column if not exists is_paid boolean not null default false,
  add column if not exists expires_at timestamptz,
  add column if not exists publication_payment_id uuid references public.payments(id);

alter table public.specialist_profiles alter column status set default 'draft';

alter table public.work_requests
  add column if not exists is_paid boolean not null default false,
  add column if not exists expires_at timestamptz;

with previous as (
  select distinct on (p.target_id)
    p.target_id, p.user_id, p.paid_at,
    coalesce(p.duration_days, t.duration_days, 30) as days
  from public.payments p
  join public.tariffs t on t.id = p.tariff_id
  where p.target_type = 'workRequest'
    and p.provider = 'yookassa'
    and p.provider_payment_id is not null
    and p.status = 'succeeded'
    and t.action = 'work_request_publication'
  order by p.target_id, p.paid_at desc nulls last, p.created_at desc
)
update public.work_requests r
set is_paid = true,
    expires_at = coalesce(r.published_at, previous.paid_at, now()) + make_interval(days => previous.days)
from previous
where previous.target_id = r.id and previous.user_id = r.author_id;

update public.work_requests
set status = 'draft'
where status = 'published' and (is_paid = false or expires_at is null);

-- Backfill only an actually matched successful provider payment. An orphan payment
-- must be investigated rather than attached to an unrelated specialist.
with previous as (
  select distinct on (p.target_id)
    p.target_id, p.id, p.paid_at,
    coalesce(p.duration_days, t.duration_days, 30) as days
  from public.payments p
  join public.tariffs t on t.id = p.tariff_id
  where p.target_type = 'specialist'
    and p.provider = 'yookassa'
    and p.provider_payment_id is not null
    and p.status = 'succeeded'
    and t.action = 'specialist_publication'
  order by p.target_id, p.paid_at desc nulls last, p.created_at desc
)
update public.specialist_profiles s
set is_paid = true,
    publication_payment_id = previous.id,
    expires_at = coalesce(previous.paid_at, now()) + make_interval(days => previous.days)
from previous
where previous.target_id = s.id
  and s.user_id = (select p.user_id from public.payments p where p.id = previous.id);

-- Avoid advertising unpaid legacy profiles as active after the schema is installed.
update public.specialist_profiles
set status = 'draft'
where status = 'published'
  and (is_paid = false or expires_at is null or expires_at <= now());

-- Historic successful payments that already delivered their target must be marked
-- consumed. Otherwise the first replay could grant another full term for free.
update public.payments p
set applied_at = coalesce(p.paid_at, p.created_at)
where p.status = 'succeeded'
  and p.applied_at is null
  and (
    (p.target_type = 'listing' and exists (
      select 1 from public.listings l
      where l.id = p.target_id and l.author_id = p.user_id and l.is_paid = true
    ))
    or (p.target_type = 'vacancy' and exists (
      select 1 from public.vacancies v
      where v.id = p.target_id and v.author_id = p.user_id and v.is_paid = true
    ))
    or (p.target_type = 'workRequest' and exists (
      select 1 from public.work_requests r
      where r.id = p.target_id and r.author_id = p.user_id and r.is_paid = true
    ))
    or (p.target_type = 'specialist' and exists (
      select 1 from public.specialist_profiles s
      where s.id = p.target_id and s.user_id = p.user_id and s.publication_payment_id = p.id
    ))
    or (p.target_type = 'application' and exists (
      select 1 from public.applications a
      where a.id = p.target_id and a.applicant_user_id = p.user_id and a.is_paid = true
    ))
    or (p.target_type = 'fair_application' and exists (
      select 1 from public.fair_applications f
      where f.id = p.target_id and f.user_id = p.user_id and f.payment_status = 'succeeded'
    ))
    or (p.target_type = 'ad_marquee' and exists (
      select 1 from public.ad_marquee_placements m
      where m.id = p.target_id and m.user_id = p.user_id and m.payment_id = p.id
    ))
  );

-- New publicly visible specialists require a paid, still valid entitlement.
drop policy if exists "Public can read published specialists" on public.specialist_profiles;
create policy "Public can read paid specialists and own profile" on public.specialist_profiles
  for select to anon, authenticated
  using (
    (status = 'published' and is_paid = true and expires_at > now())
    or user_id = (select auth.uid())
    or private.is_admin()
  );

drop policy if exists "Public can read published work requests" on public.work_requests;
create policy "Public can read paid unexpired work requests or own" on public.work_requests
  for select to anon, authenticated
  using (
    (status = 'published' and is_paid = true and expires_at > now())
    or author_id = (select auth.uid())
    or private.is_admin()
  );

drop policy if exists "Users can insert own work requests" on public.work_requests;
create policy "Users can insert own unpaid work requests" on public.work_requests
  for insert to authenticated
  with check (author_id = (select auth.uid()) and status in ('draft', 'pending_payment') and is_paid = false);

drop policy if exists "Users can update own work requests" on public.work_requests;
create policy "Users can update own unpaid work requests" on public.work_requests
  for update to authenticated
  using (author_id = (select auth.uid()) or private.is_admin())
  with check (
    private.is_admin() or
    (author_id = (select auth.uid()) and status in ('draft', 'pending_payment', 'archived') and is_paid = false)
  );

-- All specialist edits go through the authenticated server API; the service role
-- can save drafts and deactivate profiles but the browser cannot publish via REST.
revoke insert, update, delete on public.specialist_profiles from anon, authenticated;
drop policy if exists "Users can insert own specialist profile" on public.specialist_profiles;
drop policy if exists "Users can update own specialist profile" on public.specialist_profiles;
drop policy if exists "Users can delete own specialist profile" on public.specialist_profiles;

create or replace function public.apply_confirmed_payment(p_payment_id uuid, p_provider_payment_id text)
returns table(next_status text, newly_applied boolean)
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_payment public.payments%rowtype;
  v_tariff_action public.tariff_action;
  v_duration integer;
  v_owner uuid;
  v_status public.publication_status;
  v_application_status text;
  v_marquee_status text;
  v_specialist_payment_id uuid;
  v_now timestamptz := clock_timestamp();
  v_next_status text := 'published';
begin
  select * into v_payment
  from public.payments
  where id = p_payment_id
  for update;

  if not found then
    raise exception 'Payment not found';
  end if;

  if v_payment.user_id is null or v_payment.tariff_id is null then
    raise exception 'Payment owner or tariff is missing';
  end if;

  if v_payment.provider = 'yookassa' then
    if p_provider_payment_id is null
      or v_payment.provider_payment_id is null
      or v_payment.provider_payment_id <> p_provider_payment_id then
      raise exception 'Provider payment reference does not match';
    end if;
  elsif v_payment.provider <> 'mock' or p_provider_payment_id is not null then
    raise exception 'Unsupported payment provider';
  end if;

  if v_payment.status = 'refunded' then
    raise exception 'Refunded payment cannot be applied';
  end if;

  if v_payment.amount <= 0 then
    raise exception 'Payment amount must be positive';
  end if;

  select action, coalesce(v_payment.duration_days, duration_days)
  into v_tariff_action, v_duration
  from public.tariffs
  where id = v_payment.tariff_id;

  if not found or (
    case v_tariff_action
      when 'listing_publication' then 'listing'
      when 'vacancy_publication' then 'vacancy'
      when 'work_request_publication' then 'workRequest'
      when 'job_response' then 'application'
      when 'fair_participation' then 'fair_application'
      when 'specialist_publication' then 'specialist'
      when 'ad_marquee' then 'ad_marquee'
    end is distinct from v_payment.target_type)
  then
    raise exception 'Payment tariff does not match target';
  end if;

  if v_payment.applied_at is not null then
    if v_payment.status <> 'succeeded' then
      raise exception 'Applied payment has inconsistent status';
    end if;
    return query select
      case when v_payment.target_type = 'application' then 'sent'
           when v_payment.target_type = 'ad_marquee' then 'paid'
           else 'published' end,
      false;
    return;
  end if;

  if v_payment.target_type = 'listing' then
    select author_id, status into v_owner, v_status
    from public.listings where id = v_payment.target_id for update;
    if not found or v_owner <> v_payment.user_id then
      raise exception 'Listing payment owner mismatch or target missing';
    end if;
    if v_status in ('draft', 'pending_payment', 'paid') then
      if v_duration is null then raise exception 'Listing duration is missing'; end if;
      update public.listings
      set status = 'published', is_paid = true,
          published_at = v_now,
          expires_at = v_now + make_interval(days => v_duration)
      where id = v_payment.target_id;
    else
      raise exception 'Listing is not awaiting this payment; reconcile before a new charge';
    end if;

  elsif v_payment.target_type = 'vacancy' then
    select author_id, status into v_owner, v_status
    from public.vacancies where id = v_payment.target_id for update;
    if not found or v_owner <> v_payment.user_id then
      raise exception 'Vacancy payment owner mismatch or target missing';
    end if;
    if v_status in ('draft', 'pending_payment', 'paid') then
      if v_duration is null then raise exception 'Vacancy duration is missing'; end if;
      update public.vacancies
      set status = 'published', is_paid = true,
          published_at = v_now,
          expires_at = v_now + make_interval(days => v_duration)
      where id = v_payment.target_id;
    else
      raise exception 'Vacancy is not awaiting this payment; reconcile before a new charge';
    end if;

  elsif v_payment.target_type = 'workRequest' then
    select author_id, status into v_owner, v_status
    from public.work_requests where id = v_payment.target_id for update;
    if not found or v_owner <> v_payment.user_id then
      raise exception 'Work request payment owner mismatch or target missing';
    end if;
    if v_status in ('draft', 'pending_payment', 'paid') then
      if v_duration is null then raise exception 'Work request duration is missing'; end if;
      update public.work_requests
      set status = 'published', is_paid = true, published_at = v_now,
          expires_at = v_now + make_interval(days => v_duration)
      where id = v_payment.target_id;
    else
      raise exception 'Work request is not awaiting this payment; reconcile before a new charge';
    end if;

  elsif v_payment.target_type = 'specialist' then
    select user_id, status, publication_payment_id
    into v_owner, v_status, v_specialist_payment_id
    from public.specialist_profiles where id = v_payment.target_id for update;
    if not found or v_owner <> v_payment.user_id then
      raise exception 'Specialist payment owner mismatch or target missing';
    end if;
    if v_status not in ('draft', 'pending_payment') or v_specialist_payment_id = v_payment.id then
      raise exception 'Specialist profile is not awaiting this payment';
    end if;
    if v_duration is null then raise exception 'Specialist duration is missing'; end if;
    update public.specialist_profiles
    set status = 'published', is_paid = true,
        publication_payment_id = v_payment.id,
        expires_at = v_now + make_interval(days => v_duration),
        updated_at = v_now
    where id = v_payment.target_id;

  elsif v_payment.target_type = 'application' then
    v_next_status := 'sent';
    select applicant_user_id, status into v_owner, v_application_status
    from public.applications where id = v_payment.target_id for update;
    if not found or v_owner <> v_payment.user_id then
      raise exception 'Application payment owner mismatch or target missing';
    end if;
    if v_application_status in ('pending_payment', 'paid') then
      update public.applications
      set status = 'sent', is_paid = true, sent_at = v_now, updated_at = v_now
      where id = v_payment.target_id;
    else
      raise exception 'Application is not awaiting this payment';
    end if;

  elsif v_payment.target_type = 'fair_application' then
    select user_id, status into v_owner, v_status
    from public.fair_applications where id = v_payment.target_id for update;
    if not found or v_owner <> v_payment.user_id then
      raise exception 'Fair application payment owner mismatch or target missing';
    end if;
    if v_status in ('draft', 'pending_payment') then
      update public.fair_applications
      set status = 'published', payment_status = 'succeeded',
          published_at = v_now
      where id = v_payment.target_id;
    else
      raise exception 'Fair application is not awaiting this payment';
    end if;

  elsif v_payment.target_type = 'ad_marquee' then
    v_next_status := 'paid';
    select user_id, status into v_owner, v_marquee_status
    from public.ad_marquee_placements where id = v_payment.target_id for update;
    if not found or v_owner <> v_payment.user_id then
      raise exception 'Marquee payment owner mismatch or target missing';
    end if;
    if v_marquee_status = 'pending_payment' then
      update public.ad_marquee_placements
      set status = 'paid', payment_status = 'succeeded',
          payment_id = v_payment.id, paid_at = v_now, updated_at = v_now
      where id = v_payment.target_id;
    else
      raise exception 'Marquee target is not awaiting this payment';
    end if;
  else
    raise exception 'Unsupported payment target';
  end if;

  update public.payments
  set status = 'succeeded', paid_at = coalesce(paid_at, v_now), applied_at = v_now
  where id = p_payment_id;

  return query select v_next_status, true;
end;
$function$;

-- A public-schema RPC is safe only because service_role alone can call it.
revoke all on function public.apply_confirmed_payment(uuid, text) from public, anon, authenticated;
grant execute on function public.apply_confirmed_payment(uuid, text) to service_role;
