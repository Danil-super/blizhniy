-- Local private TEST approval intake only. No production grants or provider calls.
begin;
set local lock_timeout='3s';
set local statement_timeout='10s';
-- Match JavaScript string field budgets without rejecting valid surrogate pairs.
create function app.refund_utf16_length(input text) returns integer
 language sql immutable strict set search_path='' as $$
 select coalesce(sum(case when pg_catalog.ascii(ch)>65535 then 2 else 1 end),0)::integer
 from pg_catalog.regexp_split_to_table(input,'') as ch
$$;
create function app.placement_refund_fiscal_mode(purchase app.payment_checkout_intents) returns text
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
  (select count(*) from pg_catalog.jsonb_object_keys(body->'metadata'))<>4 or
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
create table app.payment_refund_approvals (
 id uuid primary key,
 payment_intent_id uuid not null unique references app.payment_orders(id) on delete restrict,
 approved_by uuid not null,
 reason text not null check(reason=btrim(reason) and char_length(reason) between 1 and 500),
 policy_version text not null check(policy_version='placement-full-admin-v1'),
 fiscal_mode text not null check(fiscal_mode in ('provider-automatic-full','test-without-receipt')),
 amount numeric(12,2) not null check(amount>0 and amount<'Infinity'::numeric),
 approved_at timestamptz not null default clock_timestamp() check(isfinite(approved_at))
);
create function app.guard_placement_refund_approval() returns trigger
 language plpgsql security definer set search_path='' as $$
declare session_hash text;actor uuid;version bigint;payer uuid;purchase app.payment_checkout_intents;order_status text;mode text;captured text;capture_key text;
begin
 if tg_op<>'INSERT' then raise exception 'Refund approval is immutable' using errcode='42501';end if;
 if pg_catalog.current_setting('transaction_isolation')<>'read committed' then raise exception 'Refund approval requires read committed' using errcode='23514';end if;
 session_hash:=pg_catalog.current_setting('blizhniy.refund_approval_session',true);
 if session_hash is null or session_hash !~ '^[a-f0-9]{64}$' then raise exception 'Administrator session required' using errcode='42501';end if;
 select user_id into actor from app.sessions where token_hash=session_hash;
 select auth_version into version from app.users where id=actor and role='admin' and not is_blocked and email_verified_at is not null for update;
 if not found then raise exception 'Administrator session required' using errcode='42501';end if;
 perform token_hash from app.sessions where token_hash=session_hash and user_id=actor and auth_version=version and scope='app'
  and expires_at>pg_catalog.clock_timestamp() and last_seen_at>pg_catalog.clock_timestamp()-interval '30 minutes' for update;
 if not found then raise exception 'Administrator session required' using errcode='42501';end if;
 select owner_id into payer from app.payment_checkout_intents where id=new.payment_intent_id;
 if payer is null then raise exception 'Refund purchase unavailable' using errcode='23514';end if;
 -- Administrator is already locked. Never wait on a second user's auth lock.
 perform id from app.users where id=payer for update nowait;
 select * into purchase from app.payment_checkout_intents where id=new.payment_intent_id for update;
 select status into order_status from app.payment_orders where id=new.payment_intent_id for update;
 if order_status is distinct from 'succeeded' or purchase.is_test is distinct from true or
  purchase.target_type not in ('listing','vacancy','workRequest') or purchase.duration_days is null or
  purchase.request_sha256 is distinct from pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(purchase.request_body,'UTF8')),'hex') or
  not exists(select 1 from app.payment_verifications v join app.payment_provider_links l
   on l.intent_id=v.intent_id and l.provider_payment_id=v.provider_payment_id
   where v.intent_id=purchase.id and v.status='succeeded' and v.captured_at is not null) then
  raise exception 'Original captured TEST placement required' using errcode='23514';
 end if;
 select captured_at into captured from app.payment_verifications where intent_id=purchase.id and status='succeeded';
 capture_key:=pg_catalog.left(captured,19)||'.'||pg_catalog.rpad(coalesce(pg_catalog.substring(captured,'[.]([0-9]+)Z$'),''),9,'0')||'Z';
 if capture_key collate "C" > (pg_catalog.to_char((pg_catalog.clock_timestamp()+interval '5 minutes') at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US')||'000Z') collate "C" then
  raise exception 'Refund capture chronology requires reconciliation' using errcode='23514';
 end if;
 if new.reason is null or new.reason<>pg_catalog.btrim(new.reason,U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF') or pg_catalog.char_length(new.reason) not between 1 and 500 or
  new.reason ~ '[[:cntrl:]]' or new.reason ~ U&'[\061C\200E\200F\202A-\202E\2066-\2069]' or
  app.refund_utf16_length(new.reason)>500 or
  new.reason ~* '<[[:space:]]*(/?[a-z][^<>]*|![^<>]*|[?][^<>]*)>' then
  raise exception 'Refund reason required' using errcode='23514';
 end if;
 mode:=app.placement_refund_fiscal_mode(purchase);
 -- Locks on financial rows may outlive the session. Recheck wall clock after them.
 perform token_hash from app.sessions where token_hash=session_hash and user_id=actor and auth_version=version and scope='app'
  and expires_at>pg_catalog.clock_timestamp() and last_seen_at>pg_catalog.clock_timestamp()-interval '30 minutes';
 if not found then raise exception 'Administrator session expired' using errcode='42501';end if;
 new.approved_by:=actor;new.policy_version:='placement-full-admin-v1';new.fiscal_mode:=mode;new.amount:=purchase.amount;new.approved_at:=pg_catalog.clock_timestamp();
 return new;
end;
$$;
create trigger placement_refund_approval_guard before insert or update or delete on app.payment_refund_approvals
 for each row execute function app.guard_placement_refund_approval();
create trigger placement_refund_approval_truncate_guard before truncate on app.payment_refund_approvals
 for each statement execute function app.guard_placement_refund_approval();
alter table app.payment_refund_approvals enable always trigger placement_refund_approval_guard;
alter table app.payment_refund_approvals enable always trigger placement_refund_approval_truncate_guard;
revoke all on app.payment_refund_approvals from public;
revoke all on function app.refund_utf16_length(text),app.placement_refund_fiscal_mode(app.payment_checkout_intents),app.guard_placement_refund_approval() from public;
commit;
