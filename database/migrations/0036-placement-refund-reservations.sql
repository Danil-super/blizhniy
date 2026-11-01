-- Private TEST-only full-placement reservations. No grants, POST or money/service mutations.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '10s';
create table app.payment_refund_reservations (
 id uuid primary key,
 payment_intent_id uuid not null unique references app.payment_orders(id) on delete restrict,
 provider_payment_id uuid not null,
 merchant_shop_id text not null,
 is_test boolean not null check(is_test),
 amount numeric(12,2) not null check(amount>0 and amount<'Infinity'::numeric),
 created_at timestamptz not null default clock_timestamp() check(isfinite(created_at)),
 foreign key(payment_intent_id,provider_payment_id)
  references app.payment_provider_links(intent_id,provider_payment_id) on delete restrict
);
create function app.guard_placement_refund_reservation() returns trigger
 language plpgsql set search_path='' as $$
declare purchase app.payment_checkout_intents%rowtype;
begin
 if tg_op<>'INSERT' then
  raise exception using errcode='23514',message='Refund reservation history is immutable';
 end if;
 if pg_catalog.current_setting('transaction_isolation')<>'read committed' then
  raise exception using errcode='PBR02',message='Refund reservation requires read committed';
 end if;
 -- Match financial writers: intent -> order. No target/user locks acquired here.
 select * into purchase from app.payment_checkout_intents where id=new.payment_intent_id for update;
 if not found then raise exception using errcode='23514',message='Refund purchase is unavailable';end if;
 perform id from app.payment_orders where id=new.payment_intent_id and status='succeeded' for update;
 if not found or purchase.target_type not in ('listing','vacancy','workRequest') or purchase.duration_days is null or
  purchase.is_test is distinct from true or new.is_test is distinct from true or
  new.merchant_shop_id is distinct from purchase.merchant_shop_id or new.amount is distinct from purchase.amount or
  purchase.request_sha256 is distinct from pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(purchase.request_body,'UTF8')),'hex') or
  not exists(select 1 from app.payment_verifications v where v.intent_id=new.payment_intent_id and
   v.provider_payment_id=new.provider_payment_id and v.status='succeeded' and v.captured_at is not null) then
  raise exception using errcode='23514',message='Refund requires the original captured TEST placement';
 end if;
 new.created_at:=pg_catalog.clock_timestamp();return new;
end $$;
create trigger placement_refund_reservation_guard before insert or update or delete on app.payment_refund_reservations
 for each row execute function app.guard_placement_refund_reservation();
create trigger placement_refund_reservation_truncate_guard before truncate on app.payment_refund_reservations
 for each statement execute function app.guard_placement_refund_reservation();

-- Existing receipt writers have no access to the new private table. Fixed definer
-- authority enforces this invariant without granting the web/worker refund rights.
create function app.fence_refunded_payment_fulfillment() returns trigger
 language plpgsql security definer set search_path='' as $$
begin
 if pg_catalog.current_setting('transaction_isolation')<>'read committed' then
  raise exception using errcode='PBR02',message='Refund fulfillment fence requires read committed';
 end if;
 perform id from app.payment_checkout_intents where id=new.intent_id for update;
 perform id from app.payment_orders where id=new.intent_id for update;
 -- Separate VOLATILE query sees the reservation committed during a lock wait.
 if exists(select 1 from app.payment_refund_reservations where payment_intent_id=new.intent_id) then
  raise exception using errcode='PBR01',message='Refund reservation prevents new fulfillment';
 end if;
 return new;
end $$;
create trigger payment_refund_fulfillment_fence before insert on app.payment_fulfillments
 for each row execute function app.fence_refunded_payment_fulfillment();
revoke all on app.payment_refund_reservations from public;
revoke all on function app.guard_placement_refund_reservation(),app.fence_refunded_payment_fulfillment() from public;
commit;
