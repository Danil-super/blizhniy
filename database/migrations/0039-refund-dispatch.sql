-- Private TEST outbound history. No grants, HTTP activation or service mutations.
begin;
set local lock_timeout='3s';
set local statement_timeout='10s';
create table app.payment_refund_send_attempts (
 id uuid primary key,
 operation_id uuid not null references app.payment_refund_dispatch_anchors(operation_id) on delete restrict,
 request_sha256 text not null check(request_sha256 ~ '^[a-f0-9]{64}$'),
 started_at timestamptz not null default clock_timestamp() check(isfinite(started_at)),
 unique(id,operation_id)
);
create index payment_refund_send_attempts_operation on app.payment_refund_send_attempts(operation_id);
create table app.payment_refund_candidates (
 operation_id uuid primary key references app.payment_refund_dispatch_anchors(operation_id) on delete restrict,
 attempt_id uuid not null,
 provider_refund_id uuid not null unique,
 received_at timestamptz not null default clock_timestamp() check(isfinite(received_at)),
 foreign key(attempt_id,operation_id) references app.payment_refund_send_attempts(id,operation_id) on delete restrict
);
create function app.guard_refund_dispatch() returns trigger language plpgsql set search_path='' as $$
declare
 reservation app.payment_refund_reservations%rowtype;
 purchase app.payment_checkout_intents%rowtype;
 prepared app.payment_refund_requests%rowtype;
 original_status text;
 anchor timestamptz;
begin
 if tg_op<>'INSERT' then raise exception using errcode='23514',message='Refund send history is immutable';end if;
 if pg_catalog.current_setting('transaction_isolation')<>'read committed' then
  raise exception using errcode='PBR02',message='Refund send history requires read committed';
 end if;
 select * into reservation from app.payment_refund_reservations where id=new.operation_id;
 if not found then raise exception using errcode='23514',message='Refund reservation is unavailable';end if;
 select * into purchase from app.payment_checkout_intents where id=reservation.payment_intent_id for update;
 if not found then raise exception using errcode='23514',message='Refund purchase is unavailable';end if;
 select status into original_status from app.payment_orders where id=purchase.id for update;
 if not found or original_status not in ('succeeded','refunded') then
  raise exception using errcode='23514',message='Refund requires the original captured purchase';
 end if;
 select * into reservation from app.payment_refund_reservations where id=new.operation_id;
 select q.* into prepared from app.payment_refund_requests q where q.operation_id=new.operation_id;
 if not found or reservation.payment_intent_id is distinct from purchase.id or purchase.target_type not in ('listing','vacancy','workRequest') or
  purchase.duration_days is null or purchase.is_test is distinct from true or reservation.is_test is distinct from true or
  reservation.amount is distinct from purchase.amount or reservation.merchant_shop_id is distinct from purchase.merchant_shop_id or
  purchase.request_sha256 is distinct from pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(purchase.request_body,'UTF8')),'hex') or
  prepared.request_sha256 is distinct from pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(prepared.request_body,'UTF8')),'hex') or
  prepared.idempotence_key is distinct from 'refund-'||reservation.id::text or prepared.request_body is distinct from
   pg_catalog.format('{"payment_id":"%s","amount":{"value":"%s","currency":"RUB"},"metadata":{"localRefundId":"%s","localPaymentId":"%s"}}',
    reservation.provider_payment_id,reservation.amount::text,reservation.id,reservation.payment_intent_id) then
  raise exception using errcode='23514',message='Refund send source is unavailable';
 end if;
 if not exists(select 1 from app.payment_provider_links l join app.payment_verifications v
  on v.intent_id=l.intent_id and v.provider_payment_id=l.provider_payment_id where l.intent_id=purchase.id and
   l.provider_payment_id=reservation.provider_payment_id and v.status='succeeded' and v.captured_at is not null) then
  raise exception using errcode='23514',message='Refund capture binding is unavailable';
 end if;
 select authorized_at into anchor from app.payment_refund_dispatch_anchors where operation_id=new.operation_id;
 if not found then raise exception using errcode='23514',message='Refund original window is unavailable';end if;
 if tg_relid='app.payment_refund_send_attempts'::regclass then
  if original_status<>'succeeded' or pg_catalog.clock_timestamp()>=anchor+interval '23 hours 55 minutes' or
   exists(select 1 from app.payment_refund_candidates where operation_id=new.operation_id) or
   exists(select 1 from app.payment_refund_provider_links where operation_id=new.operation_id) or
   (select count(*) from app.payment_refund_send_attempts where operation_id=new.operation_id)>=12 then
   raise exception using errcode='23514',message='Refund requires readback or operator reconciliation';
  end if;
  new.request_sha256:=prepared.request_sha256;new.started_at:=pg_catalog.clock_timestamp();return new;
 end if;
 -- A valid late reply must remain recordable after the send window expires.
 if not exists(select 1 from app.payment_refund_send_attempts where id=new.attempt_id and operation_id=new.operation_id and request_sha256=prepared.request_sha256) then
  raise exception using errcode='23514',message='Refund reply has no original send attempt';
 end if;
 new.received_at:=pg_catalog.clock_timestamp();return new;
end $$;
create trigger refund_send_attempt_guard before insert or update or delete on app.payment_refund_send_attempts
 for each row execute function app.guard_refund_dispatch();
create trigger refund_send_attempt_truncate_guard before truncate on app.payment_refund_send_attempts
 for each statement execute function app.guard_refund_dispatch();
create trigger refund_send_candidate_guard before insert or update or delete on app.payment_refund_candidates
 for each row execute function app.guard_refund_dispatch();
create trigger refund_send_candidate_truncate_guard before truncate on app.payment_refund_candidates
 for each statement execute function app.guard_refund_dispatch();
create function app.guard_refund_dispatch_identity() returns trigger language plpgsql set search_path='' as $$
begin
 if pg_catalog.current_setting('transaction_isolation')<>'read committed' then
  raise exception using errcode='PBR02',message='Refund identity requires read committed';
 end if;
 -- zz_ trigger order follows the canonical intent/order guard on BOTH tables.
 -- Serialize this UUID across different purchases, then use fresh RC statements.
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(new.provider_refund_id::text,0));
 if exists(select 1 from app.payment_refund_candidates where
   (provider_refund_id=new.provider_refund_id and operation_id<>new.operation_id) or
   (operation_id=new.operation_id and provider_refund_id<>new.provider_refund_id)) or
  exists(select 1 from app.payment_refund_provider_links where
   (provider_refund_id=new.provider_refund_id and operation_id<>new.operation_id) or
   (operation_id=new.operation_id and provider_refund_id<>new.provider_refund_id)) then
  raise exception using errcode='23514',message='Refund identity contradicts recorded history';
 end if;
 return new;
end $$;
create trigger zz_refund_dispatch_identity_guard before insert on app.payment_refund_candidates
 for each row execute function app.guard_refund_dispatch_identity();
create trigger zz_refund_dispatch_identity_guard before insert on app.payment_refund_provider_links
 for each row execute function app.guard_refund_dispatch_identity();
revoke all on app.payment_refund_send_attempts,app.payment_refund_candidates from public;
revoke all on function app.guard_refund_dispatch(),app.guard_refund_dispatch_identity() from public;
commit;
