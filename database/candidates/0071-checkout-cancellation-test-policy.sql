-- Optional TEST cancellation. Enrollment is empty until explicitly set by the database owner.
begin;
set local lock_timeout='3s';
set local statement_timeout='10s';
create table app.checkout_cancellation_test_enrollment (
 target_type text primary key check(target_type in ('listing','vacancy','workRequest','application','specialist')),
 owner_id uuid not null references app.users(id) on delete restrict,
 shop_id text not null check(shop_id ~ '^[1-9][0-9]{0,63}$')
);
revoke all on app.checkout_cancellation_test_enrollment from public;
do $$begin
 if exists(select 1 from pg_catalog.pg_class c cross join lateral pg_catalog.aclexplode(c.relacl) allowed
  where c.oid='app.checkout_cancellation_test_enrollment'::regclass and allowed.grantee<>c.relowner) then
  raise exception 'Checkout cancellation TEST enrollment requires owner-only access';
 end if;
end $$;
alter table app.payment_checkout_cancellations drop constraint payment_checkout_cancellations_target_type_check;
alter table app.payment_checkout_cancellations add constraint payment_checkout_cancellations_target_type_check
 check(target_type in ('listing','vacancy','workRequest','application','specialist','fair_application','ad_marquee'));

create function app.checkout_cancellation_admitted(purchase app.payment_checkout_intents) returns boolean
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
revoke all on function app.checkout_cancellation_admitted(app.payment_checkout_intents) from public;

create or replace function app.guard_checkout_cancellation() returns trigger
 language plpgsql volatile security definer set search_path='' as $$
declare session_hash text;actor uuid;version bigint;purchase app.payment_checkout_intents;checkout app.payment_orders;previous app.payment_checkout_cancellations;
begin
 if tg_op<>'INSERT' then raise exception 'Checkout cancellation history is immutable' using errcode='42501';end if;
 if pg_catalog.current_setting('transaction_isolation')<>'read committed' then raise exception 'Cancellation requires read committed' using errcode='PCA04';end if;
 session_hash:=pg_catalog.current_setting('blizhniy.checkout_cancel_session',true);
 if session_hash is null or session_hash !~ '^[a-f0-9]{64}$' then raise exception 'Owner session required' using errcode='PCA03';end if;
 select user_id into actor from app.sessions where token_hash=session_hash;
 select auth_version into version from app.users where id=actor and not is_blocked and email_verified_at is not null for update;
 if not found then raise exception 'Owner session required' using errcode='PCA03';end if;
 perform token_hash from app.sessions where token_hash=session_hash and user_id=actor and auth_version=version and scope='app'
  and expires_at>pg_catalog.clock_timestamp() and last_seen_at>pg_catalog.clock_timestamp()-interval '30 minutes' for update;
 if not found then raise exception 'Owner session required' using errcode='PCA03';end if;
 select * into purchase from app.payment_checkout_intents where id=new.payment_id for update nowait;
 if not found or purchase.owner_id<>actor or not app.checkout_cancellation_admitted(purchase) then
  raise exception 'TEST checkout required' using errcode='PCA01';end if;
 select * into checkout from app.payment_orders where id=purchase.id for update nowait;
 if not found or row(checkout.owner_id,checkout.target_type,checkout.target_id,checkout.target_revision)
  is distinct from row(purchase.owner_id,purchase.target_type,purchase.target_id,purchase.target_revision) then raise exception 'TEST checkout required' using errcode='PCA01';end if;
 select * into previous from app.payment_checkout_cancellations where payment_id=purchase.id;
 if found then new.owner_id:=previous.owner_id;new.target_type:=previous.target_type;new.cancelled_at:=previous.cancelled_at;return new;end if;
 -- Provider links, verifications and fulfillment receipts all require a dispatch anchor by foreign key.
 if checkout.status<>'created' or exists(select 1 from app.payment_dispatch_anchors where intent_id=purchase.id) then
  raise exception 'Checkout dispatch may already have started' using errcode='PCA02';end if;
 new.owner_id:=actor;new.target_type:=purchase.target_type;new.cancelled_at:=pg_catalog.clock_timestamp();return new;
end $$;
commit;
