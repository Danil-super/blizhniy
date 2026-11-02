-- Private GET-proven TEST refund identity/history. No runtime grants or service effects.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '10s';
create table app.payment_refund_provider_links (
 operation_id uuid primary key references app.payment_refund_dispatch_anchors(operation_id) on delete restrict,
 provider_refund_id uuid not null unique,
 created_at timestamptz not null default clock_timestamp() check(isfinite(created_at)),
 unique(operation_id,provider_refund_id)
);
create table app.payment_refund_observations (
 operation_id uuid not null,
 provider_refund_id uuid not null,
 status text not null check(status in ('pending','succeeded','canceled')),
 provider_created_at text not null,
 observed_at timestamptz not null default clock_timestamp() check(isfinite(observed_at)),
 primary key(operation_id,status),
 foreign key(operation_id,provider_refund_id) references app.payment_refund_provider_links(operation_id,provider_refund_id) on delete restrict
);
create function app.guard_refund_journal() returns trigger
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
begin
 if tg_op<>'INSERT' then raise exception using errcode='23514',message='Refund journal is immutable';end if;
 if pg_catalog.current_setting('transaction_isolation')<>'read committed' then
  raise exception using errcode='PBR02',message='Refund journal requires read committed';
 end if;
 select * into reservation from app.payment_refund_reservations where id=new.operation_id;
 if not found then raise exception using errcode='23514',message='Refund reservation is unavailable';end if;
 select * into purchase from app.payment_checkout_intents where id=reservation.payment_intent_id for update;
 if not found then raise exception using errcode='23514',message='Refund purchase is unavailable';end if;
 perform id from app.payment_orders where id=purchase.id and status in ('succeeded','refunded') for update;
 if not found then raise exception using errcode='23514',message='Refund requires the original captured purchase';end if;
 -- Fresh statements after waits see the latest committed source/history.
 select * into reservation from app.payment_refund_reservations where id=new.operation_id;
 select q.* into prepared from app.payment_refund_requests q join app.payment_refund_dispatch_anchors a on a.operation_id=q.operation_id
  where q.operation_id=new.operation_id;
 if not found or purchase.target_type not in ('listing','vacancy','workRequest') or purchase.duration_days is null or
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
create trigger refund_provider_link_guard before insert or update or delete on app.payment_refund_provider_links
 for each row execute function app.guard_refund_journal();
create trigger refund_provider_link_truncate_guard before truncate on app.payment_refund_provider_links
 for each statement execute function app.guard_refund_journal();
create trigger refund_observation_guard before insert or update or delete on app.payment_refund_observations
 for each row execute function app.guard_refund_journal();
create trigger refund_observation_truncate_guard before truncate on app.payment_refund_observations
 for each statement execute function app.guard_refund_journal();
revoke all on app.payment_refund_provider_links,app.payment_refund_observations from public;
revoke all on function app.guard_refund_journal() from public;
commit;
