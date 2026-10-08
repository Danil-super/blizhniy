-- Complete request bytes/receipt PII are server-only, not public payment fields.
-- No historical UNKNOWN intent is reconstructed or backfilled by this change.
create table private.payment_checkout_intents (
  payment_id uuid primary key references public.payments(id) on delete restrict,
  user_id uuid not null,
  target_type text not null,
  target_id uuid not null,
  tariff_id uuid not null,
  tariff_key text not null check (length(tariff_key) between 1 and 128),
  amount numeric(12, 2) not null check (amount > 0),
  purchased_duration_days integer check (purchased_duration_days between 1 and 365),
  merchant_shop_id text not null check (merchant_shop_id ~ '^[a-zA-Z0-9_-]{1,64}$'),
  is_test boolean not null,
  request_body text not null check (octet_length(request_body) between 2 and 16384),
  request_sha256 text not null check (request_sha256 ~ '^[0-9a-f]{64}$'),
  first_attempt_authorized_at timestamptz not null
);
alter table private.payment_checkout_intents enable row level security;
revoke all on private.payment_checkout_intents from public, anon, authenticated, service_role;
grant usage on schema private to service_role;
grant select, insert on private.payment_checkout_intents to service_role;
-- PostgreSQL FOR UPDATE needs UPDATE privilege on at least one column.
-- The immutable trigger rejects even a no-op UPDATE of this column.
grant update (payment_id) on private.payment_checkout_intents to service_role;

create function private.enforce_yookassa_checkout_snapshot()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare
  v_payment public.payments%rowtype;
  v_body jsonb;
  v_receipt_item jsonb;
begin
  if tg_op <> 'INSERT' then
    raise exception using errcode = '22023', message = 'Checkout snapshot is immutable';
  end if;
  -- The parent precedes the intent for every path, including direct inserts.
  select p.* into v_payment from public.payments p where p.id = new.payment_id for update;
  if not found or v_payment.provider <> 'yookassa'
    or v_payment.status <> 'created' or v_payment.provider_payment_id is not null
    or v_payment.created_at < clock_timestamp() - interval '5 minutes'
    or v_payment.created_at > clock_timestamp()
    or new.user_id is distinct from v_payment.user_id
    or new.target_type is distinct from v_payment.target_type
    or new.target_id is distinct from v_payment.target_id
    or new.tariff_id is distinct from v_payment.tariff_id
    or new.amount is distinct from v_payment.amount
    or new.purchased_duration_days is distinct from v_payment.purchased_duration_days then
    raise exception using errcode = '22023', message = 'Checkout snapshot payment binding mismatch';
  end if;
  if new.request_body is null or octet_length(new.request_body) > 16384 then
    raise exception using errcode = '22023', message = 'Checkout snapshot body size is invalid';
  end if;
  v_body := new.request_body::jsonb;
  if jsonb_typeof(v_body) is distinct from 'object'
    or v_body #>> '{amount,currency}' is distinct from 'RUB'
    or v_body #>> '{amount,value}' is null
    or (v_body #>> '{amount,value}')::numeric is distinct from v_payment.amount
    or v_body -> 'capture' is distinct from 'true'::jsonb
    or v_body #>> '{confirmation,type}' is distinct from 'redirect'
    or coalesce(length(v_body #>> '{confirmation,return_url}'), 0) not between 1 and 2048
    or v_body #>> '{confirmation,return_url}' !~ '^https?://[^[:space:]]+$'
    or coalesce(length(v_body ->> 'description'), 0) not between 1 and 128
    or v_body #>> '{metadata,localPaymentId}' is distinct from new.payment_id::text
    or v_body #>> '{metadata,targetId}' is distinct from new.target_id::text
    or v_body #>> '{metadata,targetType}' is distinct from new.target_type
    or v_body #>> '{metadata,tariffId}' is distinct from new.tariff_key then
    raise exception using errcode = '22023', message = 'Checkout snapshot body binding mismatch';
  end if;
  if v_body ? 'receipt' then
    if jsonb_typeof(v_body -> 'receipt') is distinct from 'object'
      or jsonb_typeof(v_body #> '{receipt,items}') is distinct from 'array'
      or jsonb_array_length(v_body #> '{receipt,items}') <> 1
      or v_body #> '{receipt,internet}' is distinct from 'true'::jsonb
      or coalesce(length(v_body #>> '{receipt,customer,email}'), 0) not between 3 and 254 then
      raise exception using errcode = '22023', message = 'Checkout snapshot receipt is invalid';
    end if;
    v_receipt_item := v_body #> '{receipt,items,0}';
    if v_receipt_item #>> '{amount,currency}' is distinct from 'RUB'
      or v_receipt_item #>> '{amount,value}' is null
      or (v_receipt_item #>> '{amount,value}')::numeric is distinct from v_payment.amount
      or coalesce(length(v_receipt_item ->> 'description'), 0) not between 1 and 128
      or v_receipt_item ->> 'quantity' is distinct from '1'
      or v_receipt_item ->> 'payment_mode' is distinct from 'full_payment'
      or v_receipt_item ->> 'payment_subject' is distinct from 'service'
      or jsonb_typeof(v_receipt_item -> 'vat_code') is distinct from 'number'
      or v_receipt_item ->> 'vat_code' is null
      or v_receipt_item ->> 'vat_code' !~ '^[0-9]{1,2}$'
      or (v_receipt_item ->> 'vat_code')::integer not between 1 and 12 then
      raise exception using errcode = '22023', message = 'Checkout snapshot receipt binding mismatch';
    end if;
  end if;
  -- An earliest committed authorization, not a claim that the vendor received
  -- the request. Database time/hash are never supplied by an HTTP caller.
  new.first_attempt_authorized_at := clock_timestamp();
  new.request_sha256 := encode(sha256(convert_to(new.request_body, 'UTF8')), 'hex');
  return new;
end;
$$;
create trigger yookassa_checkout_intent_immutable
before insert or update or delete on private.payment_checkout_intents
for each row execute function private.enforce_yookassa_checkout_snapshot();

create function private.freeze_yookassa_payment_inputs()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if exists (select 1 from private.payment_checkout_intents i where i.payment_id = old.id)
    and (new.id is distinct from old.id or new.user_id is distinct from old.user_id
      or new.target_type is distinct from old.target_type or new.target_id is distinct from old.target_id
      or new.tariff_id is distinct from old.tariff_id or new.provider is distinct from old.provider
      or new.amount is distinct from old.amount or new.created_at is distinct from old.created_at
      or new.purchased_duration_days is distinct from old.purchased_duration_days) then
    raise exception using errcode = '22023', message = 'Checkout payment input binding is immutable';
  end if;
  -- Status, provider-ID adoption, verified paid_at and fulfillment markers are
  -- deliberately left to the existing monotonic settlement/fulfillment guard.
  return new;
end;
$$;
create trigger freeze_yookassa_payment_inputs before update on public.payments
for each row execute function private.freeze_yookassa_payment_inputs();

create function public.authorize_yookassa_checkout_attempt(
  p_payment_id uuid, p_user_id uuid, p_target_type text, p_target_id uuid,
  p_merchant_shop_id text, p_is_test boolean
) returns table (
  payment_id uuid, user_id uuid, target_type text, target_id uuid, tariff_id uuid,
  tariff_key text, amount numeric, purchased_duration_days integer, merchant_shop_id text,
  is_test boolean, request_body text, request_sha256 text, first_attempt_authorized_at timestamptz,
  remaining_ms numeric, provider_payment_id text, financial_status text, decision text
) language plpgsql volatile security invoker set search_path = '' as $$
declare
  v_payment public.payments%rowtype;
  v_intent private.payment_checkout_intents%rowtype;
  v_remaining numeric;
  v_decision text;
begin
  select p.* into v_payment from public.payments p where p.id = p_payment_id for update;
  if not found or v_payment.provider <> 'yookassa'
    or v_payment.user_id is distinct from p_user_id
    or v_payment.target_type is distinct from p_target_type
    or v_payment.target_id is distinct from p_target_id then
    raise exception using errcode = '22023', message = 'Checkout authorization payment binding mismatch';
  end if;
  select i.* into v_intent from private.payment_checkout_intents i
    where i.payment_id = p_payment_id for update;
  if not found then
    -- Explicit read-only historical exception; provenance cannot be invented.
    v_decision := case when v_payment.provider_payment_id is not null then 'legacy_recover' else 'manual' end;
  else
    if v_intent.merchant_shop_id is distinct from p_merchant_shop_id
      or v_intent.is_test is distinct from p_is_test then
      raise exception using errcode = '22023', message = 'Checkout merchant binding mismatch';
    end if;
    if v_intent.user_id is distinct from v_payment.user_id
      or v_intent.target_type is distinct from v_payment.target_type
      or v_intent.target_id is distinct from v_payment.target_id
      or v_intent.tariff_id is distinct from v_payment.tariff_id
      or v_intent.amount is distinct from v_payment.amount
      or v_intent.purchased_duration_days is distinct from v_payment.purchased_duration_days then
      raise exception using errcode = '22023', message = 'Checkout snapshot payment binding mismatch';
    end if;
    -- Read real time AFTER locks. now()/transaction_timestamp() can be stale.
    v_remaining := extract(epoch from (v_intent.first_attempt_authorized_at + interval '23 hours 55 minutes' - clock_timestamp())) * 1000;
    v_decision := case when v_payment.provider_payment_id is not null then 'recover'
      when v_remaining > 0 and v_payment.status in ('created', 'pending') then 'post' else 'manual' end;
  end if;
  return query select v_payment.id, v_payment.user_id, v_payment.target_type, v_payment.target_id,
    v_payment.tariff_id, v_intent.tariff_key, v_payment.amount, v_payment.purchased_duration_days,
    v_intent.merchant_shop_id, v_intent.is_test, v_intent.request_body, v_intent.request_sha256,
    v_intent.first_attempt_authorized_at, v_remaining, v_payment.provider_payment_id,
    v_payment.status::text, v_decision;
end;
$$;

create function public.prepare_yookassa_checkout_intent(
  p_payment_id uuid, p_user_id uuid, p_target_type text, p_target_id uuid,
  p_tariff_key text, p_amount numeric, p_purchased_duration_days integer,
  p_merchant_shop_id text, p_is_test boolean, p_request_body text
) returns table (
  payment_id uuid, user_id uuid, target_type text, target_id uuid, tariff_id uuid,
  tariff_key text, amount numeric, purchased_duration_days integer, merchant_shop_id text,
  is_test boolean, request_body text, request_sha256 text, first_attempt_authorized_at timestamptz,
  remaining_ms numeric, provider_payment_id text, financial_status text, decision text
) language plpgsql volatile security invoker set search_path = '' as $$
declare
  v_payment public.payments%rowtype;
  v_intent private.payment_checkout_intents%rowtype;
begin
  select p.* into v_payment from public.payments p where p.id = p_payment_id for update;
  if not found or p_user_id is null or v_payment.provider <> 'yookassa'
    or v_payment.user_id is distinct from p_user_id
    or v_payment.target_type is distinct from p_target_type
    or v_payment.target_id is distinct from p_target_id
    or v_payment.amount is distinct from p_amount
    or v_payment.purchased_duration_days is distinct from p_purchased_duration_days then
    raise exception using errcode = '22023', message = 'Checkout snapshot payment binding mismatch';
  end if;
  select i.* into v_intent from private.payment_checkout_intents i where i.payment_id = p_payment_id for update;
  if found then
    if v_intent.request_body is distinct from p_request_body
      or v_intent.tariff_key is distinct from p_tariff_key
      or v_intent.merchant_shop_id is distinct from p_merchant_shop_id
      or v_intent.is_test is distinct from p_is_test then
      raise exception using errcode = '22023', message = 'Checkout snapshot is immutable';
    end if;
  else
    insert into private.payment_checkout_intents (payment_id, user_id, target_type, target_id,
      tariff_id, tariff_key, amount, purchased_duration_days, merchant_shop_id, is_test,
      request_body, request_sha256, first_attempt_authorized_at)
    values (v_payment.id, v_payment.user_id, v_payment.target_type, v_payment.target_id,
      v_payment.tariff_id, p_tariff_key, v_payment.amount, v_payment.purchased_duration_days,
      p_merchant_shop_id, p_is_test, p_request_body, '', clock_timestamp());
  end if;
  return query select * from public.authorize_yookassa_checkout_attempt(p_payment_id, p_user_id,
    p_target_type, p_target_id, p_merchant_shop_id, p_is_test);
end;
$$;

revoke all on function private.enforce_yookassa_checkout_snapshot() from public, anon, authenticated;
revoke all on function private.freeze_yookassa_payment_inputs() from public, anon, authenticated;
grant execute on function private.enforce_yookassa_checkout_snapshot(), private.freeze_yookassa_payment_inputs() to service_role;
revoke all on function public.authorize_yookassa_checkout_attempt(uuid, uuid, text, uuid, text, boolean) from public, anon, authenticated;
revoke all on function public.prepare_yookassa_checkout_intent(uuid, uuid, text, uuid, text, numeric, integer, text, boolean, text) from public, anon, authenticated;
grant execute on function public.authorize_yookassa_checkout_attempt(uuid, uuid, text, uuid, text, boolean) to service_role;
grant execute on function public.prepare_yookassa_checkout_intent(uuid, uuid, text, uuid, text, numeric, integer, text, boolean, text) to service_role;

notify pgrst, 'reload schema';
