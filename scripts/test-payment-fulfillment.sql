-- Run only on a disposable staging database with synthetic seeded users.
-- Example: psql "$STAGING_DATABASE_URL" -v owner_id='<synthetic profiles.id>' -f scripts/test-payment-fulfillment.sql
\set ON_ERROR_STOP on
begin;

do $check$
begin
  if has_function_privilege('anon', 'public.apply_confirmed_payment(uuid,text)', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.apply_confirmed_payment(uuid,text)', 'EXECUTE') then
    raise exception 'Payment RPC is callable by a browser role';
  end if;
  if has_table_privilege('authenticated', 'public.specialist_profiles', 'UPDATE') then
    raise exception 'Browser role can publish a specialist profile';
  end if;
end
$check$;

select set_config('app.test_owner_id', :'owner_id', true);
select set_config('app.test_payment_id', gen_random_uuid()::text, true);
select set_config('app.test_listing_id', gen_random_uuid()::text, true);

do $fixture$
declare
  owner_id uuid := current_setting('app.test_owner_id')::uuid;
  listing_id uuid := current_setting('app.test_listing_id')::uuid;
  payment_id uuid := current_setting('app.test_payment_id')::uuid;
  tariff public.tariffs%rowtype;
  category_id uuid;
  v_region_id uuid;
  city_id uuid;
begin
  if not exists (select 1 from public.profiles where id = owner_id) then
    raise exception 'Synthetic owner profile must exist on staging';
  end if;
  select * into tariff from public.tariffs where action = 'listing_publication';
  select id into category_id from public.categories where active = true limit 1;
  select id into v_region_id from public.regions where active = true limit 1;
  select c.id into city_id from public.cities c where c.active = true and c.region_id = v_region_id limit 1;
  if tariff.id is null or category_id is null or v_region_id is null or city_id is null then
    raise exception 'Staging tariffs, regions, cities and categories must be seeded';
  end if;

  insert into public.listings(id,author_id,listing_type,category_id,region_id,city_id,title,description,status,is_paid)
  values(listing_id,owner_id,'sell',category_id,v_region_id,city_id,'Synthetic payment test','Temporary rollback fixture','pending_payment',false);

  insert into public.payments(id,user_id,tariff_id,target_type,target_id,provider,provider_payment_id,amount,status,duration_days)
  values(payment_id,owner_id,tariff.id,'listing',listing_id,'yookassa','synthetic_provider_payment',tariff.price,'created',tariff.duration_days);
end
$fixture$;

-- Simulate a target failure after payment.status and applied_at have changed.
-- The SQL transaction must roll that earlier payment write back.
create function public.test_fail_payment_success() returns trigger language plpgsql as $fail$
begin
  if new.status = 'published' then
    raise exception 'synthetic write failure';
  end if;
  return new;
end
$fail$;

create trigger test_fail_payment_success
before update on public.listings
for each row execute function public.test_fail_payment_success();

do $assert_rollback$
begin
  begin
    perform * from public.apply_confirmed_payment(
      current_setting('app.test_payment_id')::uuid, 'synthetic_provider_payment'
    );
    raise exception 'Expected a simulated write failure';
  exception when others then
    if sqlerrm <> 'synthetic write failure' then
      raise;
    end if;
  end;

  if not exists(
    select 1 from public.listings
    where id = current_setting('app.test_listing_id')::uuid
      and status = 'pending_payment' and is_paid = false
  ) or not exists(
    select 1 from public.payments
    where id = current_setting('app.test_payment_id')::uuid
      and status = 'created' and applied_at is null
  ) then
    raise exception 'Fulfillment leaked a partial commit';
  end if;
end
$assert_rollback$;

drop trigger test_fail_payment_success on public.listings;
drop function public.test_fail_payment_success();

do $assert_success$
declare
  first_time timestamptz;
  first_expiry timestamptz;
  application_count integer;
  status_text text;
  was_new boolean;
  duplicate_payment_id uuid := gen_random_uuid();
begin
  select next_status, newly_applied into status_text, was_new
  from public.apply_confirmed_payment(current_setting('app.test_payment_id')::uuid, 'synthetic_provider_payment');
  if status_text <> 'published' or was_new is distinct from true then
    raise exception 'Initial payment not fulfilled';
  end if;
  select published_at, expires_at into first_time, first_expiry
  from public.listings where id = current_setting('app.test_listing_id')::uuid;
  if first_expiry is null or first_expiry <= first_time or not exists(
    select 1 from public.payments
    where id = current_setting('app.test_payment_id')::uuid
      and status = 'succeeded' and applied_at is not null
  ) then
    raise exception 'Payment and listing did not commit together';
  end if;

  select next_status, newly_applied into status_text, was_new
  from public.apply_confirmed_payment(current_setting('app.test_payment_id')::uuid, 'synthetic_provider_payment');
  if status_text <> 'published' or was_new is distinct from false
    or not exists(
      select 1 from public.listings
      where id = current_setting('app.test_listing_id')::uuid
        and published_at = first_time and expires_at = first_expiry
    ) then
    raise exception 'Duplicate webhook extended or republished the target';
  end if;

  -- Another payment cannot reserve the same still-open target.
  insert into public.payments
    (id,user_id,tariff_id,target_type,target_id,provider,provider_payment_id,amount,status)
  select duplicate_payment_id, user_id, tariff_id, target_type, target_id,
         'yookassa', 'synthetic_second_provider', amount, 'created'
  from public.payments where id = current_setting('app.test_payment_id')::uuid;
  begin
    insert into public.payments
      (id,user_id,tariff_id,target_type,target_id,provider,provider_payment_id,amount,status)
    select gen_random_uuid(), user_id, tariff_id, target_type, target_id,
           'yookassa', 'synthetic_third_provider', amount, 'pending'
    from public.payments where id = current_setting('app.test_payment_id')::uuid;
    raise exception 'Expected open-target uniqueness failure';
  exception when unique_violation then
    null;
  end;

  select count(*) into application_count
  from public.payments
  where target_id = current_setting('app.test_listing_id')::uuid
    and status in ('created', 'pending');
  if application_count <> 1 then
    raise exception 'Target has more than one open provider reservation';
  end if;

  -- A distinct newly paid transaction cannot silently consume a publication
  -- that was already delivered by the first transaction.
  begin
    perform * from public.apply_confirmed_payment(duplicate_payment_id,'synthetic_second_provider');
    raise exception 'Expected already-delivered target to reject a new payment';
  exception when others then
    if sqlerrm <> 'Listing is not awaiting this payment; reconcile before a new charge' then
      raise;
    end if;
  end;
  if not exists (select 1 from public.payments where id=duplicate_payment_id and applied_at is null)
    or not exists (select 1 from public.listings where id=current_setting('app.test_listing_id')::uuid and expires_at=first_expiry) then
    raise exception 'Second payment consumed an already delivered entitlement';
  end if;
end
$assert_success$;

-- Paid specialist profile becomes visible for exactly one tariff term, and a
-- duplicate success cannot extend the entitlement.
do $specialist_fixture$
declare
  owner_id uuid := current_setting('app.test_owner_id')::uuid;
  profile_id uuid := gen_random_uuid();
  payment_id uuid := gen_random_uuid();
  tariff public.tariffs%rowtype;
  v_region_id uuid;
  city_id uuid;
  first_expiry timestamptz;
  was_new boolean;
  next_status text;
begin
  select * into tariff from public.tariffs where action = 'specialist_publication';
  select id into v_region_id from public.regions where active = true limit 1;
  select c.id into city_id from public.cities c where c.active = true and c.region_id = v_region_id limit 1;
  if tariff.id is null or v_region_id is null or city_id is null then
    raise exception 'Specialist test fixtures missing';
  end if;
  if exists (select 1 from public.specialist_profiles where user_id = owner_id) then
    raise exception 'Use a synthetic owner with no existing specialist profile';
  end if;

  insert into public.specialist_profiles(id,user_id,name,region_id,city_id,status,skills,description,price_from,contact_phone)
  values(profile_id,owner_id,'Synthetic specialist',v_region_id,city_id,'pending_payment',
         array['repair'],'Temporary rollback-only specialist profile',1000,'+70000000000');
  insert into public.payments(id,user_id,tariff_id,target_type,target_id,provider,provider_payment_id,amount,status,duration_days)
  values(payment_id,owner_id,tariff.id,'specialist',profile_id,'yookassa','synthetic_specialist_provider',
         tariff.price,'pending',tariff.duration_days);

  -- The old server's direct activation path must still fail after migration.
  begin
    update public.specialist_profiles set status='published' where id=profile_id;
    raise exception 'Expected unpaid direct specialist activation to fail';
  exception when check_violation then
    null;
  end;

  select p.next_status,p.newly_applied into next_status,was_new
  from public.apply_confirmed_payment(payment_id,'synthetic_specialist_provider') p;
  if next_status <> 'published' or was_new is distinct from true then
    raise exception 'Specialist payment did not publish';
  end if;

  select expires_at into first_expiry from public.specialist_profiles
  where id=profile_id and is_paid=true and status='published' and publication_payment_id=payment_id;
  if first_expiry is null or first_expiry <= now() then
    raise exception 'Paid specialist entitlement was not saved';
  end if;

  -- Changing entitlement fields without the linked applied payment must fail.
  begin
    update public.specialist_profiles set is_paid=false where id=profile_id;
    raise exception 'Expected published specialist entitlement to remain paid';
  exception when check_violation then
    null;
  end;
  if not exists (
    select 1 from public.specialist_profiles
    where id=profile_id and is_paid=true and publication_payment_id=payment_id
  ) then
    raise exception 'Rejected entitlement edit changed the specialist';
  end if;

  select p.next_status,p.newly_applied into next_status,was_new
  from public.apply_confirmed_payment(payment_id,'synthetic_specialist_provider') p;
  if was_new is distinct from false or not exists (
    select 1 from public.specialist_profiles where id=profile_id and expires_at=first_expiry
  ) then
    raise exception 'Duplicate payment extended specialist entitlement';
  end if;
end
$specialist_fixture$;

rollback;
