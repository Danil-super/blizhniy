-- Proposed TEST rollout. An empty enrollment authorizes no hosted shop.
begin;
set local lock_timeout='3s';
set local statement_timeout='10s';

create table app.specialist_test_enrollment (
 singleton boolean primary key default true check(singleton),
 owner_id uuid not null references app.users(id) on delete cascade,
 shop_id text not null check(shop_id ~ '^[1-9][0-9]{0,63}$'),
 enabled_at timestamptz not null default clock_timestamp() check(isfinite(enabled_at))
);
revoke all on app.specialist_test_enrollment from public;
do $$ begin
 if exists(select 1 from pg_class c cross join lateral aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) p
  where c.oid='app.specialist_test_enrollment'::regclass and p.grantee<>c.relowner) then
  raise exception 'Specialist TEST enrollment requires owner-only access';
 end if;
end $$;
-- Replace enrollment by deleting and inserting. Each opening has its own cutover time.
create trigger specialist_test_enrollment_no_update before update on app.specialist_test_enrollment
 for each row execute function app.reject_payment_intent_mutation();

create or replace function app.guard_specialist_checkout_terms() returns trigger
 language plpgsql security definer set search_path=pg_catalog as $$
 declare purchase app.payment_checkout_intents; session_hash text; actor uuid; version bigint;
 begin
  if tg_op<>'INSERT' then raise exception using errcode='23514',message='Specialist checkout terms are immutable';end if;
  if current_setting('transaction_isolation')<>'read committed' then raise exception using errcode='PSP01',message='Specialist checkout requires read committed';end if;
  session_hash:=current_setting('blizhniy.specialist_checkout_session',true);
  if session_hash is null or session_hash !~ '^[a-f0-9]{64}$' then raise exception using errcode='PSP01',message='Specialist owner session required';end if;
  select user_id into actor from app.sessions where token_hash=session_hash;
  select auth_version into version from app.users where id=actor and not is_blocked and email_verified_at is not null for update;
  if not found then raise exception using errcode='PSP01',message='Specialist owner session required';end if;
  perform token_hash from app.sessions where token_hash=session_hash and user_id=actor and auth_version=version and scope='app'
   and expires_at>clock_timestamp() and last_seen_at>clock_timestamp()-interval '30 minutes' for update;
  if not found then raise exception using errcode='PSP01',message='Specialist owner session required';end if;
  select * into purchase from app.payment_checkout_intents where id=new.intent_id for update;
  if not found or purchase.owner_id<>actor or purchase.target_type<>'specialist' or not purchase.is_test
   or purchase.tariff_id<>'specialist-publication' or purchase.duration_days is null then
   raise exception using errcode='PSP01',message='Specialist TEST purchase required';end if;
  if purchase.merchant_shop_id='local-fixture-shop' then
   if purchase.request_body::jsonb->'metadata' ? 'publicationMode' then
    raise exception using errcode='PSP01',message='Unexpected simulator purchase mode';
   end if;
  else
   if purchase.request_body::jsonb#>>'{metadata,publicationMode}' is distinct from 'specialist-account-test-v1'
    or jsonb_typeof(purchase.request_body::jsonb->'receipt') is distinct from 'object' then
    raise exception using errcode='PSP01',message='Specialist TEST marker required';
   end if;
   perform owner_id from app.specialist_test_enrollment where owner_id=actor and shop_id=purchase.merchant_shop_id
    and enabled_at<=purchase.created_at for share;
   if not found then raise exception using errcode='PSP01',message='Specialist TEST enrollment required';end if;
  end if;
  perform id from app.payment_orders where id=purchase.id and status='created' for update;
  if not found then raise exception using errcode='PSP01',message='Unstarted specialist order required';end if;
  perform id from app.service_publications where id=purchase.target_id for update;
  perform id from app.cities where id=(select city_id from app.service_publications where id=purchase.target_id) for share;
  perform id from app.specialist_categories where id=(select profession_id from app.service_publications where id=purchase.target_id) for share;
  perform user_id from app.cabinet_profiles where user_id=actor for share;
  perform id from app.service_moderation where publication_id=purchase.target_id and revision=purchase.target_revision for share;
  if not app.specialist_checkout_ready(purchase.target_id,actor,purchase.target_revision) or
   not exists(select 1 from app.tariffs where id=purchase.tariff_id and action='specialist_publication' and active and price>0
    and price=purchase.amount and duration_days=purchase.duration_days and duration_days between 1 and 3650) or
   exists(select 1 from app.payment_dispatch_anchors where intent_id=purchase.id) or exists(select 1 from app.payment_provider_links where intent_id=purchase.id) then
   raise exception using errcode='PSP01',message='Specialist purchase terms changed';end if;
  -- The admission may have waited on enrollment, the target or a reference after locking the session.
  if not exists(select 1 from app.sessions where token_hash=session_hash and user_id=actor and auth_version=version and scope='app'
   and expires_at>clock_timestamp() and last_seen_at>clock_timestamp()-interval '30 minutes') then
   raise exception using errcode='PSP01',message='Specialist owner session expired';
  end if;
  new.created_at:=clock_timestamp();return new;
 end $$;

-- Captured purchases have immutable admission terms. Closing enrollment only stops new purchases.
create or replace function app.guard_specialist_payment_fulfillment() returns trigger
 language plpgsql security definer set search_path=pg_catalog as $$
 declare purchase app.payment_checkout_intents;
 begin
  select * into purchase from app.payment_checkout_intents where id=new.intent_id;
  if purchase.target_type is distinct from 'specialist' then return new;end if;
  if current_setting('transaction_isolation')<>'read committed' or new.published_at is not null or new.expires_at is not null then
   raise exception using errcode='PSP03',message='Specialist period is server assigned';end if;
  perform id from app.users where id=purchase.owner_id for update;
  select * into purchase from app.payment_checkout_intents where id=new.intent_id for update;
  perform id from app.payment_orders where id=purchase.id for update;
  perform id from app.service_publications where id=purchase.target_id for update;
  perform id from app.cities where id=(select city_id from app.service_publications where id=purchase.target_id) for share;
  perform id from app.specialist_categories where id=(select profession_id from app.service_publications where id=purchase.target_id) for share;
  perform user_id from app.cabinet_profiles where user_id=purchase.owner_id for share;
  perform id from app.service_moderation where publication_id=purchase.target_id and revision=purchase.target_revision for share;
  if not purchase.is_test or purchase.tariff_id<>'specialist-publication' or purchase.duration_days is null or
   not exists(select 1 from app.specialist_checkout_terms where intent_id=purchase.id) or
   not exists(select 1 from app.payment_orders where id=purchase.id and status='succeeded') or
   not exists(select 1 from app.payment_provider_links l join app.payment_verifications v on v.intent_id=l.intent_id and v.provider_payment_id=l.provider_payment_id
    where l.intent_id=purchase.id and v.status='succeeded' and v.captured_at is not null and v.captured_at::timestamptz>=purchase.created_at and v.captured_at::timestamptz<=clock_timestamp()) then
   raise exception using errcode='PSP03',message='Specialist capture or target unavailable';end if;
  if purchase.request_body::jsonb#>>'{metadata,publicationMode}'='specialist-account-test-v1'
   and not app.phone_is_confirmed(purchase.owner_id) then
   raise exception using errcode='P7601',message='Verified phone required';end if;
  if not app.specialist_checkout_ready(purchase.target_id,purchase.owner_id,purchase.target_revision) then
   raise exception using errcode='PSP03',message='Specialist capture or target unavailable';end if;
  new.published_at:=clock_timestamp();new.expires_at:=new.published_at+purchase.duration_days*interval '24 hours';return new;
 end $$;

create or replace function app.guard_specialist_publication_window() returns trigger
 language plpgsql security definer set search_path=pg_catalog as $$
 begin
  if new.kind<>'specialist' then
   if tg_op='UPDATE' and old.kind='specialist' and old.is_paid then raise exception using errcode='PSP03',message='Paid specialist kind is immutable';end if;
   return new;
  end if;
  if tg_op='UPDATE' and row(new.status,new.is_paid,new.published_at,new.expires_at,new.id,new.author_id,new.kind)
   is not distinct from row(old.status,old.is_paid,old.published_at,old.expires_at,old.id,old.author_id,old.kind) then return new;end if;
  if new.is_paid or new.status in ('published','paid') or new.published_at is not null or new.expires_at is not null then
   if not exists(select 1 from app.payment_fulfillments f join app.payment_checkout_intents i on i.id=f.intent_id
    join app.specialist_checkout_terms terms on terms.intent_id=i.id join app.payment_orders o on o.id=i.id and o.status='succeeded'
    where i.target_type='specialist' and i.owner_id=new.author_id and i.target_id=new.id and i.target_revision=new.revision
     and i.is_test and f.published_at=new.published_at and f.expires_at=new.expires_at) then
    raise exception using errcode='PSP03',message='Specialist publication requires its recorded receipt';end if;
  end if;
  return new;
 end $$;

-- authorize() inserts the anchor before each possible POST. A linked payment is read with GET.
create function app.check_specialist_test_dispatch() returns trigger
 language plpgsql security definer set search_path=pg_catalog as $$
 declare purchase app.payment_checkout_intents;
 begin
  select * into purchase from app.payment_checkout_intents where id=new.intent_id;
  if purchase.request_body::jsonb#>>'{metadata,publicationMode}'='specialist-account-test-v1' then
   if current_setting('transaction_isolation')<>'read committed' or not purchase.is_test or purchase.target_type<>'specialist'
    or not exists(select 1 from app.specialist_checkout_terms where intent_id=purchase.id) then
    raise exception using errcode='PSP01',message='Specialist TEST dispatch requires admitted terms';
   end if;
   -- An earlier authorization may have reached the provider. authorize() also verifies the key, bytes and deadline.
   if exists(select 1 from app.payment_dispatch_anchors where intent_id=purchase.id
    and authorized_at+interval '23 hours 55 minutes'>clock_timestamp()) then return new;end if;
   perform owner_id from app.specialist_test_enrollment where owner_id=purchase.owner_id and shop_id=purchase.merchant_shop_id for share;
   if not found then raise exception using errcode='PSP01',message='Specialist TEST dispatch is closed';end if;
  end if;
  return new;
 end $$;
revoke all on function app.check_specialist_test_dispatch() from public;
create trigger specialist_test_dispatch_guard before insert on app.payment_dispatch_anchors
 for each row execute function app.check_specialist_test_dispatch();

create function app.require_specialist_test_terms() returns trigger
 language plpgsql security definer set search_path=pg_catalog as $$
 begin
  if not exists(select 1 from app.specialist_checkout_terms where intent_id=new.id) then
   raise exception using errcode='PSP01',message='Specialist TEST purchase was not admitted';
  end if;
  return new;
 end $$;
revoke all on function app.require_specialist_test_terms() from public;
create constraint trigger specialist_test_terms_required after insert on app.payment_checkout_intents
 deferrable initially deferred for each row
 when (new.request_body::jsonb#>>'{metadata,publicationMode}'='specialist-account-test-v1')
 execute function app.require_specialist_test_terms();

-- Hosted specialist purchases require a confirmed phone even when other placements can omit one.
create or replace function app.guard_phone_wait_job() returns trigger language plpgsql security definer set search_path=pg_catalog as $$
 declare owner_id uuid; specialist_phone_required boolean;
 begin
  if old.last_code='phone_required' and new.state in ('queued','processing') then new.last_code:='phone_required';end if;
  if new.state='waiting_phone' then
   select i.owner_id, exists(select 1 from app.specialist_checkout_terms t where t.intent_id=i.id
    and i.target_type='specialist' and i.is_test and i.request_body::jsonb#>>'{metadata,publicationMode}'='specialist-account-test-v1')
    into owner_id,specialist_phone_required from app.payment_checkout_intents i where i.id=new.intent_id;
   perform 1 from app.users where id=owner_id for update;
   new.claim_id:=null;new.lease_until:=null;new.attempts:=0;
   if (not specialist_phone_required and not (select required from app.phone_verification_policy where singleton)) or app.phone_is_confirmed(owner_id) then
    new.state:='queued';new.last_code:='phone_required';new.next_attempt_at:=clock_timestamp();
   else new.last_code:='phone_required';end if;
  end if;
  return new;
 end $$;
commit;
