-- Accept the exact original receipt and publication marker used by hosted placement checkout.
begin;
set local lock_timeout='3s';
set local statement_timeout='10s';

create or replace function app.placement_refund_fiscal_mode(purchase app.payment_checkout_intents) returns text
 language plpgsql immutable set search_path='' as $$
declare body jsonb;invoice jsonb;item jsonb;return_url text;authority text;host text;
begin
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
  app.refund_utf16_length(body->'confirmation'->>'return_url') not between 1 and 2048 or
  (select count(*) from pg_catalog.jsonb_object_keys(body->'metadata'))<>
   (case when body->'metadata' ? 'publicationMode' then 5 else 4 end) or
  (body->'metadata' ? 'publicationMode' and (purchase.is_test is distinct from true or
   purchase.target_type not in ('listing','vacancy','workRequest') or
   body->'metadata'->'publicationMode' is distinct from '"account-test-v1"'::jsonb or not (body ? 'receipt'))) or
  pg_catalog.jsonb_typeof(body->'metadata'->'localPaymentId') is distinct from 'string' or pg_catalog.jsonb_typeof(body->'metadata'->'targetId') is distinct from 'string' or
  pg_catalog.jsonb_typeof(body->'metadata'->'targetType') is distinct from 'string' or pg_catalog.jsonb_typeof(body->'metadata'->'tariffId') is distinct from 'string' or
  body->'metadata'->>'localPaymentId' is distinct from purchase.id::text or body->'metadata'->>'targetId' is distinct from purchase.target_id::text or
  body->'metadata'->>'targetType' is distinct from purchase.target_type or body->'metadata'->>'tariffId' is distinct from purchase.tariff_id or
  (body ? 'description' and (pg_catalog.jsonb_typeof(body->'description') is distinct from 'string' or
   app.refund_utf16_length(body->>'description')>128 or body->>'description' ~ '[[:cntrl:]]')) then
  raise exception using errcode='23514',message='Refund original request binding is invalid';
 end if;
 -- The supported server return URL has an ASCII DNS authority (optional :443).
 -- Reject credentials, other ports, IP/noncanonical authorities and whitespace.
 return_url:=body->'confirmation'->>'return_url';
 authority:=pg_catalog.substring(return_url,'^[hH][tT][tT][pP][sS]://([^/?#]+)([/?#]|$)');
 host:=pg_catalog.lower(pg_catalog.regexp_replace(authority,':443$',''));
 if host is null or pg_catalog.octet_length(authority)<>pg_catalog.char_length(authority) or pg_catalog.char_length(host)>253 or
  host !~ '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?[.])*[a-z]([a-z0-9-]{0,61}[a-z0-9])?$' or
  return_url ~ '[[:space:][:cntrl:]]' or pg_catalog.strpos(return_url,pg_catalog.chr(92))>0 or
  return_url ~ U&'[\00A0\1680\2000-\200A\2028\2029\202F\205F\3000\FEFF]' then
  raise exception 'Refund return URL is not canonical HTTPS' using errcode='23514';
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
   app.refund_utf16_length(invoice->'customer'->>'email')>254 or invoice->'customer'->>'email' !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' or
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
   pg_catalog.jsonb_typeof(item->'description') is distinct from 'string' or app.refund_utf16_length(item->>'description') not between 1 and 128 or
   item->>'description' ~ '[[:cntrl:]]' or item->>'payment_mode' is distinct from 'full_payment' or item->>'payment_subject' is distinct from 'service' or
   item->'quantity' is distinct from '1'::jsonb or (item->>'vat_code')::numeric not between 1 and 12 or
   (item->>'vat_code')::numeric<>pg_catalog.trunc((item->>'vat_code')::numeric) then
   raise exception using errcode='23514',message='Refund original receipt item is invalid';
  end if;
 end if;
 return case when body ? 'receipt' then 'provider-automatic-full' else 'test-without-receipt' end;
end;
$$;

create or replace function app.apply_placement_refund_effect() returns trigger
 language plpgsql security definer set search_path='' as $$
declare
 reservation app.payment_refund_reservations%rowtype;
 purchase app.payment_checkout_intents%rowtype;
 prepared app.payment_refund_requests%rowtype;
 previous app.payment_refund_effects%rowtype;
 original_receipt app.payment_fulfillments%rowtype;
 renewal app.payment_renewals%rowtype;
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
  not (purchase.target_type in ('listing','vacancy','workRequest') and purchase.duration_days is not null or
   purchase.target_type in ('fair_application','ad_marquee') and app.refund_target_admitted(purchase.id,new.operation_id)) or
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
 -- Reuse the canonical original amount, metadata, URL and fiscal receipt proof.
 perform app.placement_refund_fiscal_mode(purchase);
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
  elsif purchase.target_type in ('fair_application','ad_marquee') then
   select id,author_id,case kind when 'fair' then 'fair_application' when 'marquee' then 'ad_marquee' end as kind,status,is_paid,published_at,expires_at
    into target from app.service_publications where id=purchase.target_id for update;
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
   if exists(select 1 from app.payment_orders o where o.id<>purchase.id and o.owner_id=purchase.owner_id and o.target_type=purchase.target_type and o.target_id=purchase.target_id and (o.status in ('created','pending') or o.status='succeeded' and not exists(select 1 from app.payment_fulfillments f where f.intent_id=o.id))) then
    raise exception using errcode='23514',message='Refund target has an unresolved replacement checkout';
   end if;
   result:='revoked';
  end if;
 end if;
 if not app.refund_target_admitted(purchase.id,new.operation_id) then
  raise exception using errcode='PRN01',message='Refund the latest purchase first and resolve any checkout';
 end if;
 update app.payment_orders set status='refunded' where id=purchase.id and status='succeeded';
 if result='revoked' then
  select * into renewal from app.payment_renewals where intent_id=purchase.id;
  if found then
   if not exists(select 1 from app.payment_orders where id=renewal.previous_intent_id and status='succeeded') then
    raise exception using errcode='PRN01',message='Previous paid period is unavailable';
   end if;
   if purchase.target_type='listing' then
    update app.listings set is_paid=true,published_at=renewal.previous_published_at,expires_at=renewal.previous_expires_at,
     status=case when status in ('published','paid') and renewal.previous_expires_at<=pg_catalog.clock_timestamp() then 'archived' else status end,
     updated_at=pg_catalog.clock_timestamp() where id=purchase.target_id;
   else
    update app.work_publications set is_paid=true,published_at=renewal.previous_published_at,expires_at=renewal.previous_expires_at,
     status=case when status in ('published','paid') and renewal.previous_expires_at<=pg_catalog.clock_timestamp() then 'archived' else status end,
     updated_at=pg_catalog.clock_timestamp() where id=purchase.target_id;
   end if;
  elsif purchase.target_type='listing' then
   update app.listings set is_paid=false,status=case when status in ('published','paid') then 'archived' else status end,updated_at=pg_catalog.clock_timestamp() where id=purchase.target_id;
  elsif purchase.target_type in ('fair_application','ad_marquee') then
   update app.service_publications set is_paid=false,status=case when status in ('published','paid') then 'archived' else status end,updated_at=pg_catalog.clock_timestamp() where id=purchase.target_id;
  else
   update app.work_publications set is_paid=false,status=case when status in ('published','paid') then 'archived' else status end,updated_at=pg_catalog.clock_timestamp() where id=purchase.target_id;
  end if;
 end if;
 new.payment_intent_id:=purchase.id;new.provider_refund_id:=refund_id;new.target_type:=purchase.target_type;
 new.target_id:=purchase.target_id;new.effect:=result;new.applied_at:=pg_catalog.clock_timestamp();
 return new;
end $$;

commit;
