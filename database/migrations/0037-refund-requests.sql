-- Private initial TEST refund request/window only. No grants, dispatch or service effects.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '10s';
create table app.payment_refund_requests (
 operation_id uuid primary key references app.payment_refund_reservations(id) on delete restrict,
 idempotence_key text not null unique,
 request_body text not null check(octet_length(request_body) between 1 and 4096),
 request_sha256 text not null check(request_sha256 ~ '^[a-f0-9]{64}$'),
 created_at timestamptz not null default clock_timestamp() check(isfinite(created_at))
);
create table app.payment_refund_dispatch_anchors (
 operation_id uuid primary key references app.payment_refund_requests(operation_id) on delete restrict,
 authorized_at timestamptz not null default clock_timestamp() check(isfinite(authorized_at))
);
create function app.guard_refund_request_history() returns trigger
 language plpgsql set search_path='' as $$
declare
 reservation app.payment_refund_reservations%rowtype;
 purchase app.payment_checkout_intents%rowtype;
 stored app.payment_refund_requests%rowtype;
 expected_body text;
 expected_key text;
begin
 if tg_op<>'INSERT' then
  raise exception using errcode='23514',message='Refund request history is immutable';
 end if;
 if pg_catalog.current_setting('transaction_isolation')<>'read committed' then
  raise exception using errcode='PBR02',message='Refund request requires read committed';
 end if;
 select * into reservation from app.payment_refund_reservations where id=new.operation_id;
 if not found then raise exception using errcode='23514',message='Refund reservation is unavailable';end if;
 select * into purchase from app.payment_checkout_intents where id=reservation.payment_intent_id for update;
 if not found then raise exception using errcode='23514',message='Refund purchase is unavailable';end if;
 perform id from app.payment_orders where id=reservation.payment_intent_id and status='succeeded' for update;
 if not found or purchase.target_type not in ('listing','vacancy','workRequest') or purchase.duration_days is null or
  purchase.is_test is distinct from true or reservation.is_test is distinct from true or
  reservation.merchant_shop_id is distinct from purchase.merchant_shop_id or reservation.amount is distinct from purchase.amount or
  purchase.request_sha256 is distinct from pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(purchase.request_body,'UTF8')),'hex') then
  raise exception using errcode='23514',message='Refund requires the original captured TEST placement';
 end if;
 -- Fresh query after lock waits; provider links and successful verification are immutable.
 if not exists(select 1 from app.payment_provider_links l join app.payment_verifications v
  on v.intent_id=l.intent_id and v.provider_payment_id=l.provider_payment_id
  where l.intent_id=reservation.payment_intent_id and l.provider_payment_id=reservation.provider_payment_id
   and v.status='succeeded' and v.captured_at is not null) then
  raise exception using errcode='23514',message='Refund capture binding is unavailable';
 end if;
 expected_key:='refund-'||reservation.id::text;
 -- All substitutions are canonical UUID/numeric values, never arbitrary strings.
 expected_body:=pg_catalog.format('{"payment_id":"%s","amount":{"value":"%s","currency":"RUB"},"metadata":{"localRefundId":"%s","localPaymentId":"%s"}}',
  reservation.provider_payment_id,reservation.amount::text,reservation.id,reservation.payment_intent_id);
 if tg_relid='app.payment_refund_requests'::regclass then
  if new.idempotence_key is distinct from expected_key or new.request_body is distinct from expected_body then
   raise exception using errcode='23514',message='Refund request bytes do not match the original reservation';
  end if;
  new.request_sha256:=pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(new.request_body,'UTF8')),'hex');
  new.created_at:=pg_catalog.clock_timestamp();
 else
  select * into stored from app.payment_refund_requests where operation_id=reservation.id;
  if not found or stored.idempotence_key is distinct from expected_key or stored.request_body is distinct from expected_body or
   stored.request_sha256 is distinct from pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(stored.request_body,'UTF8')),'hex') then
   raise exception using errcode='23514',message='Refund preparation is unavailable';
  end if;
  new.authorized_at:=pg_catalog.clock_timestamp();
 end if;
 return new;
end $$;
create trigger refund_request_guard before insert or update or delete on app.payment_refund_requests
 for each row execute function app.guard_refund_request_history();
create trigger refund_request_truncate_guard before truncate on app.payment_refund_requests
 for each statement execute function app.guard_refund_request_history();
create trigger refund_dispatch_guard before insert or update or delete on app.payment_refund_dispatch_anchors
 for each row execute function app.guard_refund_request_history();
create trigger refund_dispatch_truncate_guard before truncate on app.payment_refund_dispatch_anchors
 for each statement execute function app.guard_refund_request_history();
revoke all on app.payment_refund_requests,app.payment_refund_dispatch_anchors from public;
revoke all on function app.guard_refund_request_history() from public;
commit;
