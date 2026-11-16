-- Refuse rollback after the first renewal; paid history must never be erased.
begin;
set local lock_timeout='3s';
set local statement_timeout='10s';
lock table app.payment_orders,app.payment_renewals,app.payment_refund_approvals,app.payment_refund_reservations in access exclusive mode;
do $$ begin
 if exists(select 1 from app.payment_renewals) then raise exception using errcode='23514',message='Renewal history prevents rollback';end if;
end $$;
drop trigger renewal_refund_approval_guard on app.payment_refund_approvals;
drop trigger renewal_refund_reservation_guard on app.payment_refund_reservations;
drop function app.guard_latest_placement_refund();
drop trigger payment_repeat_purchase_guard on app.payment_orders;
drop function app.guard_placement_repeat_purchase();
drop function app.assert_placement_purchase_available(uuid,text,uuid);
create or replace function app.refund_target_admitted(payment_id uuid,operation uuid) returns boolean
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

create or replace function app.apply_work_owner_action() returns trigger
 language plpgsql security definer set search_path='' as $$
declare session_hash text;actor uuid;version bigint;target app.work_publications;initial app.work_publications;payment record;original uuid;matches integer:=0;latest text;next_status text;
begin
 if tg_op<>'INSERT' then raise exception 'Owner action history is immutable' using errcode='42501';end if;
 if pg_catalog.current_setting('transaction_isolation')<>'read committed' then raise exception 'Owner action requires read committed' using errcode='23514';end if;
 session_hash:=pg_catalog.current_setting('blizhniy.work_owner_session',true);
 if session_hash is null or session_hash !~ '^[a-f0-9]{64}$' then raise exception 'Owner session required' using errcode='42501';end if;
 select user_id into actor from app.sessions where token_hash=session_hash;
 select auth_version into version from app.users where id=actor and not is_blocked and email_verified_at is not null for update;
 if not found then raise exception 'Owner session required' using errcode='42501';end if;
 perform token_hash from app.sessions where token_hash=session_hash and user_id=actor and auth_version=version and scope='app'
  and expires_at>pg_catalog.clock_timestamp() and last_seen_at>pg_catalog.clock_timestamp()-interval '30 minutes' for update;
 if not found then raise exception 'Owner session required' using errcode='42501';end if;
 if new.action not in ('withdraw','restore','remove') or new.action is null or new.expected_revision is null or new.expected_revision not between 1 and 9223372036854775806 then
  raise exception 'Invalid owner action' using errcode='23514';end if;
 if new.action='restore' then
  if new.reason is not null then raise exception 'Invalid restore reason' using errcode='23514';end if;
 elsif new.reason is null or char_length(new.reason) not between 1 and 500 or
  new.reason<>pg_catalog.btrim(new.reason,U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF') or
  new.reason ~ '[[:cntrl:]]' or new.reason ~ U&'[\007F-\009F\061C\200E\200F\202A-\202E\2066-\2069]' or
  (select coalesce(sum(case when pg_catalog.ascii(ch)>65535 then 2 else 1 end),0) from pg_catalog.regexp_split_to_table(new.reason,'') ch)>500 or
  new.reason ~* '<[[:space:]]*(/?[a-z][^<>]*|![^<>]*|[?][^<>]*)>' then
  raise exception 'Owner closure reason required' using errcode='23514';
 end if;
 select * into initial from app.work_publications where id=new.publication_id and author_id=actor;
 if not found then raise exception 'Own publication required' using errcode='PWA01';end if;
 -- Actor is locked. Match financial writers before locking the target, never wait across owners.
 for payment in select i.id,o.status,f.published_at,f.expires_at from app.payment_checkout_intents i
  join app.payment_orders o on o.id=i.id left join app.payment_fulfillments f on f.intent_id=i.id
  where i.owner_id=actor and i.target_id=initial.id and i.target_type=initial.kind and
   (o.status in ('created','pending','succeeded') or (f.published_at=initial.published_at and f.expires_at=initial.expires_at))
  order by i.id limit 3 for update of i,o nowait loop
  if payment.status in ('created','pending') or (payment.status='succeeded' and payment.published_at is null) then
   raise exception 'Resolve publication checkout first' using errcode='PWA02';end if;
  if payment.published_at=initial.published_at and payment.expires_at=initial.expires_at and payment.status='succeeded' then original:=payment.id;matches:=matches+1;end if;
 end loop;
 select * into target from app.work_publications where id=initial.id and author_id=actor for update nowait;
 if not found or target.deleted_at is not null then raise exception 'Own publication required' using errcode='PWA01';end if;
 if target.revision<>new.expected_revision or target.published_at is distinct from initial.published_at or target.expires_at is distinct from initial.expires_at then
  raise exception 'Publication changed' using errcode='PWA02';end if;
 -- Delivery/checkout writers serialize on the same work row. Do not strand a paid response.
 if exists(select 1 from app.applications a join app.payment_orders o on o.target_type='application' and o.target_id=a.id
  where a.work_publication_id=target.id and (o.status in ('created','pending') or
   (o.status='succeeded' and (not a.is_paid or a.sent_at is null or a.status not in ('sent','viewed','selected','rejected'))))) then
  raise exception 'Resolve response checkout before changing visibility' using errcode='PWA03';end if;
 if new.action='withdraw' then
  if target.status<>'published' or not target.is_paid or target.published_at>pg_catalog.clock_timestamp() or target.expires_at<=pg_catalog.clock_timestamp() then
   raise exception 'Publication cannot be withdrawn' using errcode='PWA02';end if;
 elsif new.action='restore' then
  select action into latest from app.work_owner_actions where publication_id=target.id and owner_id=actor order by resulting_revision desc limit 1;
  if latest is distinct from 'withdraw' or target.status<>'archived' or not target.is_paid or matches<>1 or original is null or
   target.published_at is null or target.published_at>pg_catalog.clock_timestamp() or target.expires_at<=pg_catalog.clock_timestamp() or
   exists(select 1 from app.work_moderation m where m.publication_id=target.id and m.state='rejected' and m.revision>=(select target_revision from app.payment_checkout_intents where id=original)) or
   (target.kind='workRequest' and exists(select 1 from app.applications a where a.work_publication_id=target.id and a.status='selected' and a.is_paid and a.sent_at is not null)) then
   raise exception 'Current paid placement required to restore' using errcode='PWA02';end if;
  perform id from app.cities where id=target.city_id and name=target.form->>'cityName' for share nowait;
  if not found then raise exception 'Current city required' using errcode='PWA02';end if;
  perform id from app.specialist_categories where id=target.profession_id and active and
   (not(target.form ? 'professionId') or target.form->>'professionId'=id::text) for share nowait;
  if not found then raise exception 'Current profession required' using errcode='PWA02';end if;
  if exists(select 1 from app.work_publication_photos p join app.media_objects m on m.id=p.media_id where p.publication_id=target.id and (m.owner_id<>actor or m.state<>'ready')) then
   raise exception 'Current photos required' using errcode='PWA02';end if;
 end if;
 -- The financial/reference locks above never authorize an expired browser session.
 perform token_hash from app.sessions where token_hash=session_hash and user_id=actor and auth_version=version and scope='app'
  and expires_at>pg_catalog.clock_timestamp() and last_seen_at>pg_catalog.clock_timestamp()-interval '30 minutes';
 if not found then raise exception 'Owner session expired' using errcode='42501';end if;
 next_status:=case when new.action='restore' then 'published' else 'archived' end;
 new.owner_id:=actor;new.kind:=target.kind;new.resulting_revision:=new.expected_revision+1;new.status:=next_status;new.occurred_at:=pg_catalog.clock_timestamp();return new;
end $$;

create or replace function app.guard_response_target_edit() returns trigger
 language plpgsql volatile security definer set search_path='' as $$
declare
 bookkeeping text[]:=array['title','updated_at'];
 financial text[]:=array['title','updated_at','status','is_paid','published_at','expires_at'];
begin
 -- Generated title is derived from form; never exclude that source from comparison.
 if (to_jsonb(new)-bookkeeping) is not distinct from (to_jsonb(old)-bookkeeping) then return new;end if;
 if old.status='draft' and not old.is_paid and new.status='published' and new.is_paid
  and (to_jsonb(new)-financial) is not distinct from (to_jsonb(old)-financial) then return new;end if;
 -- A completed refund must still terminate its exact original placement.
 if old.is_paid and not new.is_paid and new.status=(case when old.status in ('published','paid') then 'archived' else old.status end)
  and (to_jsonb(new)-array['title','updated_at','status','is_paid']) is not distinct from (to_jsonb(old)-array['title','updated_at','status','is_paid'])
  and exists(select 1 from app.payment_checkout_intents i join app.payment_orders o on o.id=i.id
   join app.payment_fulfillments f on f.intent_id=i.id
   where i.owner_id=old.author_id and i.target_type=old.kind and i.target_id=old.id and o.status='refunded'
    and f.published_at=old.published_at and f.expires_at=old.expires_at) then return new;end if;
 perform app.require_resolved_response_checkout(old.id);
 return new;
end $$;

drop table app.payment_renewals;
drop index app.payment_order_placement_history_idx;
drop function app.guard_payment_renewal();
drop function app.apply_payment_renewal();
drop index app.payment_order_active_target_idx;
create unique index payment_order_active_target_idx on app.payment_orders(owner_id,target_type,target_id)
 where status in ('created','pending','succeeded');

create or replace function app.apply_placement_refund_effect() returns trigger
 language plpgsql security definer set search_path='' as $$
declare
 reservation app.payment_refund_reservations%rowtype;
 purchase app.payment_checkout_intents%rowtype;
 prepared app.payment_refund_requests%rowtype;
 previous app.payment_refund_effects%rowtype;
 original_receipt app.payment_fulfillments%rowtype;
 original_status text;
 refund_id uuid;
 captured text;
 refund_created text;
 stamp text;
 captured_key text;
 refunded_key text;
 target record;
 has_target boolean;
 has_receipt boolean;
 result text;
 body jsonb;
 invoice jsonb;
 item jsonb;
begin
 if tg_op<>'INSERT' then raise exception using errcode='23514',message='Refund effect history is immutable';end if;
 if pg_catalog.current_setting('transaction_isolation')<>'read committed' then
  raise exception using errcode='PBR02',message='Refund effects require read committed';
 end if;
 if new.operation_id is null or new.merchant_shop_id is null or new.merchant_shop_id !~ '^[a-zA-Z0-9_-]{1,64}$' or
  new.payment_intent_id is not null or new.provider_refund_id is not null or new.target_type is not null or
  new.target_id is not null or new.effect is not null or new.applied_at is not null then
  raise exception using errcode='23514',message='Refund effect accepts only operation and merchant';
 end if;
 select * into reservation from app.payment_refund_reservations where id=new.operation_id;
 if not found then raise exception using errcode='23514',message='Refund reservation is unavailable';end if;
 -- Match session/fulfillment order. A deleted historical user need not exist.
 perform u.id from app.users u where u.id=(select i.owner_id from app.payment_checkout_intents i where i.id=reservation.payment_intent_id) for update;
 select * into purchase from app.payment_checkout_intents where id=reservation.payment_intent_id for update;
 if not found then raise exception using errcode='23514',message='Refund purchase is unavailable';end if;
 select status into original_status from app.payment_orders where id=purchase.id for update;
 if not found or original_status not in ('succeeded','refunded') then
  raise exception using errcode='23514',message='Refund requires the original captured order';
 end if;
 -- Fresh statements after any lock wait, not a pre-wait snapshot.
 select * into reservation from app.payment_refund_reservations where id=new.operation_id;
 select q.* into prepared from app.payment_refund_requests q join app.payment_refund_dispatch_anchors a on a.operation_id=q.operation_id
  where q.operation_id=new.operation_id;
 if not found or reservation.payment_intent_id is distinct from purchase.id or
  purchase.target_type not in ('listing','vacancy','workRequest') or purchase.duration_days is null or
  purchase.is_test is distinct from true or reservation.is_test is distinct from true or
  purchase.merchant_shop_id is distinct from new.merchant_shop_id or reservation.merchant_shop_id is distinct from purchase.merchant_shop_id or
  reservation.amount is distinct from purchase.amount or
  purchase.request_sha256 is distinct from pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(purchase.request_body,'UTF8')),'hex') or
  prepared.request_sha256 is distinct from pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(prepared.request_body,'UTF8')),'hex') or
  prepared.idempotence_key is distinct from 'refund-'||reservation.id::text or prepared.request_body is distinct from
   pg_catalog.format('{"payment_id":"%s","amount":{"value":"%s","currency":"RUB"},"metadata":{"localRefundId":"%s","localPaymentId":"%s"}}',
    reservation.provider_payment_id,reservation.amount::text,reservation.id,reservation.payment_intent_id) then
  raise exception using errcode='23514',message='Refund original TEST binding is unavailable';
 end if;
 -- A coherent checksum alone does not make a malformed historical request valid.
 -- Validate the consumed original schema as well as its immutable bindings.
 body:=purchase.request_body::jsonb;
 if pg_catalog.jsonb_typeof(body) is distinct from 'object' then
  raise exception using errcode='23514',message='Refund original request shape is invalid';
 end if;
 if not (body ?& array['amount','capture','confirmation','metadata']) or
  exists(select 1 from pg_catalog.jsonb_object_keys(body) k where k not in ('amount','capture','confirmation','metadata','description','receipt')) or
  pg_catalog.jsonb_typeof(body->'amount') is distinct from 'object' or pg_catalog.jsonb_typeof(body->'confirmation') is distinct from 'object' or
  pg_catalog.jsonb_typeof(body->'metadata') is distinct from 'object' then
  raise exception using errcode='23514',message='Refund original request shape is invalid';
 end if;
 if (select count(*) from pg_catalog.jsonb_object_keys(body->'amount'))<>2 or body->'amount'->>'value' is distinct from purchase.amount::text or
  body->'amount'->>'currency' is distinct from 'RUB' or pg_catalog.jsonb_typeof(body->'amount'->'value') is distinct from 'string' or
  body->'capture' is distinct from 'true'::jsonb or
  (select count(*) from pg_catalog.jsonb_object_keys(body->'confirmation'))<>2 or body->'confirmation'->>'type' is distinct from 'redirect' or
  pg_catalog.jsonb_typeof(body->'confirmation'->'return_url') is distinct from 'string' or
  pg_catalog.char_length(body->'confirmation'->>'return_url') not between 1 and 2048 or
  (select count(*) from pg_catalog.jsonb_object_keys(body->'metadata'))<>4 or
  pg_catalog.jsonb_typeof(body->'metadata'->'localPaymentId') is distinct from 'string' or pg_catalog.jsonb_typeof(body->'metadata'->'targetId') is distinct from 'string' or
  pg_catalog.jsonb_typeof(body->'metadata'->'targetType') is distinct from 'string' or pg_catalog.jsonb_typeof(body->'metadata'->'tariffId') is distinct from 'string' or
  body->'metadata'->>'localPaymentId' is distinct from purchase.id::text or body->'metadata'->>'targetId' is distinct from purchase.target_id::text or
  body->'metadata'->>'targetType' is distinct from purchase.target_type or body->'metadata'->>'tariffId' is distinct from purchase.tariff_id or
  (body ? 'description' and (pg_catalog.jsonb_typeof(body->'description') is distinct from 'string' or
   pg_catalog.char_length(body->>'description')>128 or body->>'description' ~ '[[:cntrl:]]')) then
  raise exception using errcode='23514',message='Refund original request binding is invalid';
 end if;
 if body ? 'receipt' then
  invoice:=body->'receipt';
  if pg_catalog.jsonb_typeof(invoice) is distinct from 'object' then
   raise exception using errcode='23514',message='Refund original receipt is invalid';
  end if;
  if (select count(*) from pg_catalog.jsonb_object_keys(invoice))<>3 or not (invoice ?& array['customer','internet','items']) or
   pg_catalog.jsonb_typeof(invoice->'customer') is distinct from 'object' or invoice->'internet' is distinct from 'true'::jsonb or
   pg_catalog.jsonb_typeof(invoice->'items') is distinct from 'array' then
   raise exception using errcode='23514',message='Refund original receipt is invalid';
  end if;
  if (select count(*) from pg_catalog.jsonb_object_keys(invoice->'customer'))<>1 or
   pg_catalog.jsonb_typeof(invoice->'customer'->'email') is distinct from 'string' or
   pg_catalog.char_length(invoice->'customer'->>'email')>254 or invoice->'customer'->>'email' !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' or
   invoice->'customer'->>'email' ~ '[[:cntrl:]]' or pg_catalog.jsonb_array_length(invoice->'items')<>1 then
   raise exception using errcode='23514',message='Refund original receipt is invalid';
  end if;
  item:=invoice->'items'->0;
  if pg_catalog.jsonb_typeof(item) is distinct from 'object' then raise exception using errcode='23514',message='Refund original receipt item is invalid';end if;
  if (select count(*) from pg_catalog.jsonb_object_keys(item))<>6 or not (item ?& array['amount','description','payment_mode','payment_subject','quantity','vat_code']) or
   pg_catalog.jsonb_typeof(item->'amount') is distinct from 'object' or pg_catalog.jsonb_typeof(item->'vat_code') is distinct from 'number' then
   raise exception using errcode='23514',message='Refund original receipt item is invalid';
  end if;
  if (select count(*) from pg_catalog.jsonb_object_keys(item->'amount'))<>2 or pg_catalog.jsonb_typeof(item->'amount'->'value') is distinct from 'string' or
   item->'amount'->>'value' is distinct from purchase.amount::text or item->'amount'->>'currency' is distinct from 'RUB' or
   pg_catalog.jsonb_typeof(item->'description') is distinct from 'string' or pg_catalog.char_length(item->>'description') not between 1 and 128 or
   item->>'description' ~ '[[:cntrl:]]' or item->>'payment_mode' is distinct from 'full_payment' or item->>'payment_subject' is distinct from 'service' or
   item->'quantity' is distinct from '1'::jsonb or (item->>'vat_code')::numeric not between 1 and 12 or
   (item->>'vat_code')::numeric<>pg_catalog.trunc((item->>'vat_code')::numeric) then
   raise exception using errcode='23514',message='Refund original receipt item is invalid';
  end if;
 end if;
 select v.captured_at into captured from app.payment_verifications v join app.payment_provider_links l
  on l.intent_id=v.intent_id and l.provider_payment_id=v.provider_payment_id
  where l.intent_id=purchase.id and l.provider_payment_id=reservation.provider_payment_id and v.status='succeeded' and v.captured_at is not null;
 if not found then raise exception using errcode='23514',message='Refund capture proof is unavailable';end if;
 select l.provider_refund_id,o.provider_created_at into refund_id,refund_created from app.payment_refund_provider_links l
  join app.payment_refund_observations o on o.operation_id=l.operation_id and o.provider_refund_id=l.provider_refund_id
  where l.operation_id=new.operation_id and o.status='succeeded';
 if not found or exists(select 1 from app.payment_refund_observations where operation_id=new.operation_id and status='canceled') or
  exists(select 1 from app.payment_refund_candidates where operation_id=new.operation_id and provider_refund_id<>refund_id) then
  raise exception using errcode='23514',message='Refund requires authoritative successful verification';
 end if;
 foreach stamp in array array[captured,refund_created] loop
  if stamp is null or pg_catalog.char_length(stamp)>30 or stamp !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,9})?Z$' then
   raise exception using errcode='23514',message='Refund chronology requires reconciliation';
  end if;
  begin
   if pg_catalog.to_char((pg_catalog.left(stamp,19)||'Z')::timestamptz at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS')<>pg_catalog.left(stamp,19) then
    raise exception using errcode='23514',message='Refund calendar date is invalid';
   end if;
  exception when invalid_datetime_format or datetime_field_overflow then
   raise exception using errcode='23514',message='Refund calendar date is invalid';
  end;
 end loop;
 captured_key:=pg_catalog.left(captured,19)||'.'||pg_catalog.rpad(coalesce(pg_catalog.substring(captured,'[.]([0-9]+)Z$'),''),9,'0')||'Z';
 refunded_key:=pg_catalog.left(refund_created,19)||'.'||pg_catalog.rpad(coalesce(pg_catalog.substring(refund_created,'[.]([0-9]+)Z$'),''),9,'0')||'Z';
 if refunded_key collate "C" < captured_key collate "C" or refunded_key collate "C" >
  (pg_catalog.to_char((pg_catalog.clock_timestamp()+interval '5 minutes') at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US')||'000Z') collate "C" then
  raise exception using errcode='23514',message='Refund chronology requires reconciliation';
 end if;
 select * into previous from app.payment_refund_effects where operation_id=new.operation_id;
 if found then
  if previous.payment_intent_id is distinct from purchase.id or previous.provider_refund_id is distinct from refund_id or
   previous.merchant_shop_id is distinct from purchase.merchant_shop_id or previous.target_type is distinct from purchase.target_type or
   previous.target_id is distinct from purchase.target_id or original_status<>'refunded' then
   raise exception using errcode='23514',message='Refund effect contradicts recorded history';
  end if;
  return previous;
 end if;
 select * into original_receipt from app.payment_fulfillments where intent_id=purchase.id;
 has_receipt:=found;
 result:='unfulfilled';
 if has_receipt then
  -- Lock by ID first; owner/kind drift never grants authority over another card.
  if purchase.target_type='listing' then
   select id,author_id,'listing'::text as kind,status,is_paid,published_at,expires_at into target from app.listings where id=purchase.target_id for update;
  else
   select id,author_id,kind,status,is_paid,published_at,expires_at into target from app.work_publications where id=purchase.target_id for update;
  end if;
  has_target:=found;
  if not has_target or target.author_id is distinct from purchase.owner_id or target.kind is distinct from purchase.target_type then
   result:='missing';
  elsif target.published_at is distinct from original_receipt.published_at or target.expires_at is distinct from original_receipt.expires_at or
   exists(select 1 from app.payment_checkout_intents i join app.payment_orders o on o.id=i.id join app.payment_fulfillments f on f.intent_id=i.id
    where i.id<>purchase.id and i.owner_id=purchase.owner_id and i.target_type=purchase.target_type and i.target_id=purchase.target_id and o.status='succeeded'
     and f.published_at=target.published_at and f.expires_at=target.expires_at) then
   result:='superseded';
  else
   if exists(select 1 from app.payment_orders where id<>purchase.id and owner_id=purchase.owner_id and target_type=purchase.target_type and target_id=purchase.target_id and status in ('created','pending')) then
    raise exception using errcode='23514',message='Refund target has an unresolved replacement checkout';
   end if;
   result:='revoked';
  end if;
 end if;
 update app.payment_orders set status='refunded' where id=purchase.id and status='succeeded';
 if result='revoked' then
  if purchase.target_type='listing' then
   update app.listings set is_paid=false,status=case when status in ('published','paid') then 'archived' else status end,updated_at=pg_catalog.clock_timestamp() where id=purchase.target_id;
  else
   update app.work_publications set is_paid=false,status=case when status in ('published','paid') then 'archived' else status end,updated_at=pg_catalog.clock_timestamp() where id=purchase.target_id;
  end if;
 end if;
 new.payment_intent_id:=purchase.id;new.provider_refund_id:=refund_id;new.target_type:=purchase.target_type;
 new.target_id:=purchase.target_id;new.effect:=result;new.applied_at:=pg_catalog.clock_timestamp();
 return new;
end $$;

commit;
