-- Dormant TEST compensation execution. No grants or web/worker activation.
begin;
set local lock_timeout='3s';
set local statement_timeout='10s';
create function app.refund_target_admitted(payment_id uuid,operation uuid) returns boolean
 language plpgsql security definer set search_path='' as $$
declare purchase app.payment_checkout_intents;decision app.application_compensation_cases;
begin
 select * into purchase from app.payment_checkout_intents where id=payment_id;
 if not found then return false;end if;
 if purchase.target_type in ('listing','vacancy','workRequest') then return purchase.duration_days is not null;end if;
 if purchase.target_type<>'application' or purchase.duration_days is not null or purchase.is_test is distinct from true or operation is distinct from purchase.id then return false;end if;
 select * into decision from app.application_compensation_cases where payment_intent_id=purchase.id;
 if not found then return false;end if;
 return decision.application_id=purchase.target_id and decision.merchant_shop_id=purchase.merchant_shop_id and
  decision.amount=purchase.amount and decision.policy_version='paid-response-unread-v1' and
  decision.fiscal_mode=app.placement_refund_fiscal_mode(purchase);
end $$;
revoke all on function app.refund_target_admitted(uuid,uuid) from public;
create or replace function app.guard_placement_refund_reservation() returns trigger
 language plpgsql set search_path='' as $$
declare purchase app.payment_checkout_intents%rowtype;
 target_allowed boolean;
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
 -- Separate statements preserve legacy callers without EXECUTE on the new helper.
 if purchase.target_type='application' then target_allowed:=app.refund_target_admitted(purchase.id,new.id);
 else target_allowed:=purchase.target_type in ('listing','vacancy','workRequest') and purchase.duration_days is not null;end if;
 perform id from app.payment_orders where id=new.payment_intent_id and status='succeeded' for update;
 if not found or target_allowed is distinct from true or
  purchase.is_test is distinct from true or new.is_test is distinct from true or
  new.merchant_shop_id is distinct from purchase.merchant_shop_id or new.amount is distinct from purchase.amount or
  purchase.request_sha256 is distinct from pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(purchase.request_body,'UTF8')),'hex') or
  not exists(select 1 from app.payment_verifications v where v.intent_id=new.payment_intent_id and
   v.provider_payment_id=new.provider_payment_id and v.status='succeeded' and v.captured_at is not null) then
  raise exception using errcode='23514',message='Refund requires the original captured TEST placement';
 end if;
 new.created_at:=pg_catalog.clock_timestamp();return new;
end $$;

create or replace function app.guard_refund_request_history() returns trigger
 language plpgsql set search_path='' as $$
declare
 reservation app.payment_refund_reservations%rowtype;
 purchase app.payment_checkout_intents%rowtype;
 stored app.payment_refund_requests%rowtype;
 expected_body text;
 expected_key text;
 target_allowed boolean;
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
 -- Separate statements preserve legacy callers without EXECUTE on the new helper.
 if purchase.target_type='application' then target_allowed:=app.refund_target_admitted(purchase.id,reservation.id);
 else target_allowed:=purchase.target_type in ('listing','vacancy','workRequest') and purchase.duration_days is not null;end if;
 perform id from app.payment_orders where id=reservation.payment_intent_id and status='succeeded' for update;
 if not found or target_allowed is distinct from true or
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

create or replace function app.guard_refund_journal() returns trigger
 language plpgsql set search_path='' as $$
declare
 reservation app.payment_refund_reservations%rowtype;
 purchase app.payment_checkout_intents%rowtype;
 prepared app.payment_refund_requests%rowtype;
 captured text;
 previous app.payment_refund_observations%rowtype;
 created_key text;
 capture_key text;
 previous_key text;
 future_key text;
 expected_body text;
 target_allowed boolean;
begin
 if tg_op<>'INSERT' then raise exception using errcode='23514',message='Refund journal is immutable';end if;
 if pg_catalog.current_setting('transaction_isolation')<>'read committed' then
  raise exception using errcode='PBR02',message='Refund journal requires read committed';
 end if;
 select * into reservation from app.payment_refund_reservations where id=new.operation_id;
 if not found then raise exception using errcode='23514',message='Refund reservation is unavailable';end if;
 select * into purchase from app.payment_checkout_intents where id=reservation.payment_intent_id for update;
 if not found then raise exception using errcode='23514',message='Refund purchase is unavailable';end if;
 -- Separate statements preserve legacy callers without EXECUTE on the new helper.
 if purchase.target_type='application' then target_allowed:=app.refund_target_admitted(purchase.id,reservation.id);
 else target_allowed:=purchase.target_type in ('listing','vacancy','workRequest') and purchase.duration_days is not null;end if;
 perform id from app.payment_orders where id=purchase.id and status in ('succeeded','refunded') for update;
 if not found then raise exception using errcode='23514',message='Refund requires the original captured purchase';end if;
 -- Fresh statements after waits see the latest committed source/history.
 select * into reservation from app.payment_refund_reservations where id=new.operation_id;
 select q.* into prepared from app.payment_refund_requests q join app.payment_refund_dispatch_anchors a on a.operation_id=q.operation_id
  where q.operation_id=new.operation_id;
 if not found or target_allowed is distinct from true or
  purchase.is_test is distinct from true or reservation.is_test is distinct from true or
  reservation.amount is distinct from purchase.amount or reservation.merchant_shop_id is distinct from purchase.merchant_shop_id or
  purchase.request_sha256 is distinct from pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(purchase.request_body,'UTF8')),'hex') then
  raise exception using errcode='23514',message='Refund requires an original prepared TEST placement';
 end if;
 select v.captured_at into captured from app.payment_verifications v join app.payment_provider_links l
  on l.intent_id=v.intent_id and l.provider_payment_id=v.provider_payment_id
  where l.intent_id=purchase.id and l.provider_payment_id=reservation.provider_payment_id and v.status='succeeded' and v.captured_at is not null;
 if not found then raise exception using errcode='23514',message='Refund capture binding is unavailable';end if;
 expected_body:=pg_catalog.format('{"payment_id":"%s","amount":{"value":"%s","currency":"RUB"},"metadata":{"localRefundId":"%s","localPaymentId":"%s"}}',
  reservation.provider_payment_id,reservation.amount::text,reservation.id,reservation.payment_intent_id);
 if prepared.idempotence_key is distinct from 'refund-'||reservation.id::text or prepared.request_body is distinct from expected_body or
  prepared.request_sha256 is distinct from pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(prepared.request_body,'UTF8')),'hex') then
  raise exception using errcode='23514',message='Refund request binding is unavailable';
 end if;
 if tg_relid='app.payment_refund_provider_links'::regclass then
  new.created_at:=pg_catalog.clock_timestamp();return new;
 end if;
 if not exists(select 1 from app.payment_refund_provider_links where operation_id=new.operation_id and provider_refund_id=new.provider_refund_id) then
  raise exception using errcode='23514',message='Refund provider identity does not match';
 end if;
 if new.status is null or new.status not in ('pending','succeeded','canceled') or new.provider_created_at is null or
  pg_catalog.char_length(new.provider_created_at)>30 or
  new.provider_created_at !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,9})?Z$' then
  raise exception using errcode='23514',message='Refund observation is invalid';
 end if;
 begin
  if pg_catalog.to_char((pg_catalog.left(new.provider_created_at,19)||'Z')::timestamptz at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS')<>pg_catalog.left(new.provider_created_at,19) then
   raise exception using errcode='23514',message='Refund calendar date is invalid';
  end if;
 exception when invalid_datetime_format or datetime_field_overflow then
  raise exception using errcode='23514',message='Refund calendar date is invalid';
 end;
 -- PostgreSQL timestamps round to microseconds. Compare padded UTC text keys
 -- instead so a one-nanosecond reversal or changed identity is not lost.
 created_key:=pg_catalog.left(new.provider_created_at,19)||'.'||pg_catalog.rpad(coalesce(pg_catalog.substring(new.provider_created_at,'[.]([0-9]+)Z$'),''),9,'0')||'Z';
 capture_key:=pg_catalog.left(captured,19)||'.'||pg_catalog.rpad(coalesce(pg_catalog.substring(captured,'[.]([0-9]+)Z$'),''),9,'0')||'Z';
 future_key:=pg_catalog.to_char((pg_catalog.clock_timestamp()+interval '5 minutes') at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US')||'000Z';
 if created_key collate "C" < capture_key collate "C" or created_key collate "C" > future_key collate "C" then
  raise exception using errcode='23514',message='Refund creation time requires reconciliation';
 end if;
 for previous in select * from app.payment_refund_observations where operation_id=new.operation_id loop
  previous_key:=pg_catalog.left(previous.provider_created_at,19)||'.'||pg_catalog.rpad(coalesce(pg_catalog.substring(previous.provider_created_at,'[.]([0-9]+)Z$'),''),9,'0')||'Z';
  if previous.provider_refund_id is distinct from new.provider_refund_id or previous_key is distinct from created_key or
   (previous.status<>'pending' and previous.status<>new.status) then
   raise exception using errcode='23514',message='Refund observation contradicts recorded history';
  end if;
 end loop;
 new.observed_at:=pg_catalog.clock_timestamp();return new;
end $$;

create or replace function app.guard_refund_dispatch() returns trigger language plpgsql set search_path='' as $$
declare
 reservation app.payment_refund_reservations%rowtype;
 purchase app.payment_checkout_intents%rowtype;
 prepared app.payment_refund_requests%rowtype;
 original_status text;
 anchor timestamptz;
 target_allowed boolean;
begin
 if tg_op<>'INSERT' then raise exception using errcode='23514',message='Refund send history is immutable';end if;
 if pg_catalog.current_setting('transaction_isolation')<>'read committed' then
  raise exception using errcode='PBR02',message='Refund send history requires read committed';
 end if;
 select * into reservation from app.payment_refund_reservations where id=new.operation_id;
 if not found then raise exception using errcode='23514',message='Refund reservation is unavailable';end if;
 select * into purchase from app.payment_checkout_intents where id=reservation.payment_intent_id for update;
 if not found then raise exception using errcode='23514',message='Refund purchase is unavailable';end if;
 -- Separate statements preserve legacy callers without EXECUTE on the new helper.
 if purchase.target_type='application' then target_allowed:=app.refund_target_admitted(purchase.id,reservation.id);
 else target_allowed:=purchase.target_type in ('listing','vacancy','workRequest') and purchase.duration_days is not null;end if;
 select status into original_status from app.payment_orders where id=purchase.id for update;
 if not found or original_status not in ('succeeded','refunded') then
  raise exception using errcode='23514',message='Refund requires the original captured purchase';
 end if;
 select * into reservation from app.payment_refund_reservations where id=new.operation_id;
 select q.* into prepared from app.payment_refund_requests q where q.operation_id=new.operation_id;
 if not found or reservation.payment_intent_id is distinct from purchase.id or target_allowed is distinct from true or purchase.is_test is distinct from true or reservation.is_test is distinct from true or
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
create table app.application_compensation_refunds (
 payment_intent_id uuid primary key references app.application_compensation_cases(payment_intent_id) on delete restrict,
 merchant_shop_id text not null,
 application_id uuid not null unique references app.applications(id) on delete restrict,
 provider_refund_id uuid not null,
 amount numeric(12,2) not null check(amount>0 and amount<'Infinity'::numeric),
 applied_at timestamptz not null check(isfinite(applied_at)),
 foreign key(payment_intent_id,provider_refund_id) references app.payment_refund_provider_links(operation_id,provider_refund_id) on delete restrict
);
create function app.guard_application_compensation_refund() returns trigger
 language plpgsql security definer set search_path='' as $$
declare purchase app.payment_checkout_intents;reservation app.payment_refund_reservations;prepared app.payment_refund_requests;refund uuid;
begin
 if tg_op<>'INSERT' then raise exception 'Compensation refund history is immutable' using errcode='23514';end if;
 if pg_catalog.current_setting('transaction_isolation')<>'read committed' then raise exception 'Compensation requires read committed' using errcode='PBR02';end if;
 if new.payment_intent_id is null or new.merchant_shop_id is null or new.application_id is not null or
  new.provider_refund_id is not null or new.amount is not null or new.applied_at is not null then
  raise exception 'Compensation accepts only payment and merchant' using errcode='23514';
 end if;
 perform id from app.users where id=(select owner_id from app.payment_checkout_intents where id=new.payment_intent_id) for update;
 select * into purchase from app.payment_checkout_intents where id=new.payment_intent_id for update;
 if not found then raise exception 'Compensation payment unavailable' using errcode='23514';end if;
 perform id from app.payment_orders where id=purchase.id and status in ('succeeded','refunded') for update;
 if not found or purchase.target_type<>'application' or purchase.merchant_shop_id is distinct from new.merchant_shop_id or
  purchase.request_sha256 is distinct from pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(purchase.request_body,'UTF8')),'hex') or
  app.refund_target_admitted(purchase.id,purchase.id) is distinct from true then raise exception 'Compensation source unavailable' using errcode='23514';end if;
 select * into reservation from app.payment_refund_reservations where id=purchase.id and payment_intent_id=purchase.id;
 if not found or reservation.provider_payment_id is distinct from (select provider_payment_id from app.payment_provider_links where intent_id=purchase.id) or
  reservation.amount is distinct from purchase.amount or reservation.merchant_shop_id is distinct from purchase.merchant_shop_id or reservation.is_test is distinct from true then
  raise exception 'Compensation reservation unavailable' using errcode='23514';
 end if;
 select q.* into prepared from app.payment_refund_requests q join app.payment_refund_dispatch_anchors a on a.operation_id=q.operation_id where q.operation_id=purchase.id;
 if not found or prepared.idempotence_key is distinct from 'refund-'||purchase.id::text or
  prepared.request_sha256 is distinct from pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(prepared.request_body,'UTF8')),'hex') or
  prepared.request_body is distinct from pg_catalog.format('{"payment_id":"%s","amount":{"value":"%s","currency":"RUB"},"metadata":{"localRefundId":"%s","localPaymentId":"%s"}}',
   reservation.provider_payment_id,purchase.amount::text,purchase.id,purchase.id) or
  not exists(select 1 from app.payment_verifications where intent_id=purchase.id and provider_payment_id=reservation.provider_payment_id and status='succeeded' and captured_at is not null) then
  raise exception 'Compensation original preparation unavailable' using errcode='23514';
 end if;
 select l.provider_refund_id into refund from app.payment_refund_provider_links l
  join app.payment_refund_observations o on o.operation_id=l.operation_id and o.provider_refund_id=l.provider_refund_id
  where l.operation_id=purchase.id and o.status='succeeded';
 if not found or exists(select 1 from app.payment_refund_observations where operation_id=purchase.id and status='canceled') or
  exists(select 1 from app.payment_refund_candidates where operation_id=purchase.id and provider_refund_id<>refund) then
  raise exception 'Compensation requires authoritative success' using errcode='23514';
 end if;
 new.application_id:=purchase.target_id;new.provider_refund_id:=refund;new.amount:=purchase.amount;new.applied_at:=pg_catalog.clock_timestamp();return new;
end $$;
create function app.record_application_compensation_refund() returns trigger
 language plpgsql security definer set search_path='' as $$
begin
 update app.payment_orders set status='refunded' where id=new.payment_intent_id and status='succeeded';
 -- The inserted effect owns the transition and notification. A replay inserts neither.
 insert into app.notifications(user_id,event_key,category,tone,title,body,action_href)
  select owner_id,'application_compensation:'||new.payment_intent_id::text,'payment','success','Компенсация за отклик',
   'Плата за непросмотренный отклик возвращена.','/cabinet/otkliki' from app.payment_checkout_intents where id=new.payment_intent_id
  on conflict(user_id,event_key) do nothing;
 return new;
end $$;
create trigger application_compensation_refund_guard before insert or update or delete on app.application_compensation_refunds
 for each row execute function app.guard_application_compensation_refund();
create trigger application_compensation_refund_truncate_guard before truncate on app.application_compensation_refunds
 for each statement execute function app.guard_application_compensation_refund();
create trigger application_compensation_refund_record after insert on app.application_compensation_refunds
 for each row execute function app.record_application_compensation_refund();
revoke all on app.application_compensation_refunds from public;
revoke all on function app.guard_application_compensation_refund(),app.record_application_compensation_refund() from public;
commit;
