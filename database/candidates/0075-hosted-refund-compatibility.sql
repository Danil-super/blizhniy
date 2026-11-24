-- Apply with the pinned refund package on the hosted TEST schema.
begin;
set local lock_timeout='3s';
set local statement_timeout='10s';

-- Preserve the hosted checkout admission and all target kinds from 0071.
alter table app.payment_checkout_cancellations drop constraint payment_checkout_cancellations_target_type_check;
alter table app.payment_checkout_cancellations add constraint payment_checkout_cancellations_target_type_check
 check(target_type in ('listing','vacancy','workRequest','application','specialist','fair_application','ad_marquee'));

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

-- Only the paid marquee service is in the hosted refund scope.
create or replace function app.refund_target_admitted(payment_id uuid,operation uuid) returns boolean
 language plpgsql security definer set search_path='' as $$
declare purchase app.payment_checkout_intents;decision app.application_compensation_cases;
begin
 select * into purchase from app.payment_checkout_intents where id=payment_id;
 if not found or not purchase.is_test then return false;end if;
 if purchase.target_type in ('listing','vacancy','workRequest') then
  return purchase.duration_days is not null and
   not exists(select 1 from app.payment_renewals r join app.payment_orders o on o.id=r.intent_id and o.status='succeeded' where r.previous_intent_id=purchase.id) and
   not exists(select 1 from app.payment_orders o where o.owner_id=purchase.owner_id and o.target_type=purchase.target_type and o.target_id=purchase.target_id and o.id<>purchase.id and
    (o.status in ('created','pending') or o.status='succeeded' and not exists(select 1 from app.payment_fulfillments f where f.intent_id=o.id)));
 end if;
 if purchase.target_type='ad_marquee' then
  return purchase.duration_days is not null and exists(select 1 from app.service_payment_terms where intent_id=purchase.id);
 end if;
 if purchase.target_type<>'application' or purchase.duration_days is not null or purchase.is_test is distinct from true or operation is distinct from purchase.id then return false;end if;
 select * into decision from app.application_compensation_cases where payment_intent_id=purchase.id;
 if not found then return false;end if;
 return decision.application_id=purchase.target_id and decision.merchant_shop_id=purchase.merchant_shop_id and
  decision.amount=purchase.amount and decision.policy_version='paid-response-unread-v1' and
  decision.fiscal_mode=app.placement_refund_fiscal_mode(purchase);
end $$;

commit;
