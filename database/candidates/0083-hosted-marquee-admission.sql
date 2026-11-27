-- Per-account TEST admission for the advertising line on the hosted schema.
begin;
set local lock_timeout='3s';
set local statement_timeout='10s';

create table app.marquee_test_enrollment (
 owner_id uuid primary key references app.users(id) on delete restrict,
 shop_id text not null check(shop_id ~ '^[1-9][0-9]{0,63}$'),
 enabled_at timestamptz not null default clock_timestamp() check(isfinite(enabled_at))
);
create table app.marquee_test_admissions (
 intent_id uuid primary key references app.payment_checkout_intents(id) on delete restrict
);
revoke all on app.marquee_test_enrollment,app.marquee_test_admissions from public;

create function app.guard_marquee_test_admission() returns trigger
 language plpgsql security definer set search_path=pg_catalog as $$
declare session_hash text; actor uuid; version bigint; purchase app.payment_checkout_intents;
begin
 if tg_op<>'INSERT' then
  raise exception using errcode='23514',message='Marquee TEST admission is immutable';
 end if;
 if current_setting('transaction_isolation')<>'read committed' then
  raise exception using errcode='PSM01',message='Marquee TEST admission requires read committed';
 end if;
 session_hash:=current_setting('blizhniy.marquee_checkout_session',true);
 if session_hash is null or session_hash !~ '^[a-f0-9]{64}$' then
  raise exception using errcode='PSM01',message='Marquee owner session required';
 end if;
 select user_id into actor from app.sessions where token_hash=session_hash;
 select auth_version into version from app.users where id=actor and not is_blocked and email_verified_at is not null for update;
 if not found then raise exception using errcode='PSM01',message='Marquee owner session required';end if;
 perform token_hash from app.sessions where token_hash=session_hash and user_id=actor and auth_version=version and scope='app'
  and expires_at>clock_timestamp() and last_seen_at>clock_timestamp()-interval '30 minutes' for update;
 if not found then raise exception using errcode='PSM01',message='Marquee owner session required';end if;
 select * into purchase from app.payment_checkout_intents where id=new.intent_id for update;
 if not found or purchase.owner_id<>actor or purchase.target_type<>'ad_marquee' or not purchase.is_test or
  purchase.tariff_id<>'ad-marquee' or coalesce(purchase.duration_days,0) not between 1 and 3650 or
  purchase.merchant_shop_id !~ '^[1-9][0-9]{0,63}$' or
  purchase.request_body::jsonb#>>'{confirmation,return_url}' is distinct from
   'https://xn----9sbphbgks4a4a.xn--p1ai/oplata/uslugi/'||purchase.id::text||'?type=marquee' or
  purchase.request_body::jsonb->'metadata' ? 'publicationMode' then
  raise exception using errcode='PSM01',message='Marquee TEST purchase required';
 end if;
 if app.placement_refund_fiscal_mode(purchase) is distinct from 'provider-automatic-full' then
  raise exception using errcode='PSM01',message='Marquee original receipt required';
 end if;
 perform owner_id from app.marquee_test_enrollment where owner_id=actor and shop_id=purchase.merchant_shop_id
  and enabled_at<=purchase.created_at for share;
 if not found then raise exception using errcode='PSM01',message='Marquee TEST enrollment required';end if;
 perform id from app.payment_orders where id=purchase.id and status='created' for update;
 if not found or exists(select 1 from app.payment_dispatch_anchors where intent_id=purchase.id) or
  exists(select 1 from app.payment_provider_links where intent_id=purchase.id) then
  raise exception using errcode='PSM01',message='Unstarted marquee TEST order required';
 end if;
 if not exists(select 1 from app.sessions where token_hash=session_hash and user_id=actor and auth_version=version and scope='app'
  and expires_at>clock_timestamp() and last_seen_at>clock_timestamp()-interval '30 minutes') then
  raise exception using errcode='PSM01',message='Marquee owner session expired';
 end if;
 return new;
end $$;
create trigger marquee_test_admission_guard before insert or update or delete on app.marquee_test_admissions
 for each row execute function app.guard_marquee_test_admission();
create trigger marquee_test_admission_truncate_guard before truncate on app.marquee_test_admissions
 for each statement execute function app.guard_marquee_test_admission();
alter table app.marquee_test_admissions enable always trigger marquee_test_admission_guard;
alter table app.marquee_test_admissions enable always trigger marquee_test_admission_truncate_guard;
revoke all on function app.guard_marquee_test_admission() from public;

create function app.require_hosted_marquee_terms() returns trigger
 language plpgsql security definer set search_path=pg_catalog as $$
declare kind text;
begin
 select target_type into kind from app.payment_checkout_intents where id=new.intent_id;
 if kind in ('ad_marquee','fair_application') and (
  kind<>'ad_marquee' or not exists(select 1 from app.marquee_test_admissions where intent_id=new.intent_id) or
  tg_table_name='payment_dispatch_anchors' and not exists(select 1 from app.service_payment_terms where intent_id=new.intent_id)) then
  raise exception using errcode='PSM01',message='Hosted service payments require admitted marquee terms';
 end if;
 return new;
end $$;
create trigger hosted_marquee_payment_terms_guard before insert on app.service_payment_terms
 for each row execute function app.require_hosted_marquee_terms();
create trigger hosted_marquee_dispatch_guard before insert on app.payment_dispatch_anchors
 for each row execute function app.require_hosted_marquee_terms();
alter table app.service_payment_terms enable always trigger hosted_marquee_payment_terms_guard;
alter table app.payment_dispatch_anchors enable always trigger hosted_marquee_dispatch_guard;
revoke all on function app.require_hosted_marquee_terms() from public;

-- Ensure an unadmitted legacy purchase cannot occupy the head of the hosted queue.
alter function app.service_payment_eligible(uuid) rename to service_payment_eligible_before_marquee_admission;
create function app.service_payment_eligible(payment uuid) returns boolean
 language sql volatile security definer set search_path=pg_catalog as $$
 select exists(select 1 from app.marquee_test_admissions where intent_id=payment)
  and app.service_payment_eligible_before_marquee_admission(payment)
$$;
revoke all on function app.service_payment_eligible(uuid),app.service_payment_eligible_before_marquee_admission(uuid) from public;

grant select(intent_id),insert(intent_id) on app.marquee_test_admissions to blizhniy_runtime;
grant select(intent_id,fair_date,fair_ends_at),insert(intent_id) on app.service_payment_terms to blizhniy_runtime;
grant select(intent_id) on app.marquee_test_admissions to blizhniy_payment_reconciler;

alter table app.checkout_cancellation_test_enrollment drop constraint checkout_cancellation_test_enrollment_target_type_check;
alter table app.checkout_cancellation_test_enrollment add constraint checkout_cancellation_test_enrollment_target_type_check
 check(target_type in ('listing','vacancy','workRequest','application','specialist','ad_marquee'));

create or replace function app.checkout_cancellation_admitted(purchase app.payment_checkout_intents) returns boolean
 language plpgsql volatile set search_path='' as $$
declare body jsonb; publication_mode text; return_url text;
begin
 if not purchase.is_test then return false;end if;
 if purchase.merchant_shop_id='local-fixture-shop' then
  if purchase.target_type in ('listing','vacancy','workRequest','application') then return true;end if;
  if purchase.target_type in ('fair_application','ad_marquee') and pg_catalog.to_regclass('app.service_payment_terms') is not null then
   return exists(select 1 from app.service_payment_terms where intent_id=purchase.id);
  end if;
  return false;
 end if;

 if purchase.target_type='ad_marquee' then
  perform target_type from app.checkout_cancellation_test_enrollment where owner_id=purchase.owner_id
   and shop_id=purchase.merchant_shop_id and target_type='ad_marquee' for share nowait;
  if not found then return false;end if;
  return exists(select 1 from app.marquee_test_admissions a join app.service_payment_terms terms on terms.intent_id=a.intent_id
   where a.intent_id=purchase.id);
 end if;

 perform target_type from app.checkout_cancellation_test_enrollment
  where owner_id=purchase.owner_id and shop_id=purchase.merchant_shop_id and target_type=purchase.target_type for share nowait;
 if not found then return false;end if;
 body:=purchase.request_body::jsonb;
 publication_mode:=body#>>'{metadata,publicationMode}';
 return_url:='https://xn----9sbphbgks4a4a.xn--p1ai/oplata/'||purchase.id::text
  ||case when purchase.target_type='listing' then '' else '?type='||purchase.target_type end;
 if body#>>'{confirmation,return_url}' is distinct from return_url
  or pg_catalog.jsonb_typeof(body->'receipt') is distinct from 'object' then return false;end if;
 case purchase.target_type
  when 'listing' then return publication_mode is null or publication_mode='account-test-v1';
  when 'vacancy','workRequest' then return publication_mode is not distinct from 'account-test-v1';
  when 'specialist' then
   if publication_mode is distinct from 'specialist-account-test-v1'
    or pg_catalog.to_regclass('app.specialist_checkout_terms') is null then return false;end if;
   return exists(select 1 from app.specialist_checkout_terms where intent_id=purchase.id);
  when 'application' then
   if publication_mode is not null or pg_catalog.to_regclass('app_response.admissions') is null then return false;end if;
   return exists(select 1 from app_response.admissions
    where intent_id=purchase.id and applicant_id=purchase.owner_id and shop_id=purchase.merchant_shop_id);
  else return false;
 end case;
end $$;

commit;
