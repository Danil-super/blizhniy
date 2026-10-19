-- Private checkout storage only. No grants, provider dispatch, settlement or publication.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '10s';
create table app.payment_checkout_intents (
 id uuid primary key,
 owner_id uuid not null,
 target_type text not null check(target_type in ('listing','vacancy','workRequest','specialist','application','fair_application','ad_marquee')),
 target_id uuid not null,
 target_revision bigint not null check(target_revision>=1),
 tariff_id text not null check(tariff_id ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(tariff_id)<=100),
 amount numeric(12,2) not null check(amount>0 and amount<'Infinity'::numeric),
 duration_days integer check(duration_days between 1 and 3650),
 merchant_shop_id text not null check(merchant_shop_id ~ '^[a-zA-Z0-9_-]{1,64}$'),
 is_test boolean not null,
 request_body text not null check(octet_length(request_body) between 1 and 16384),
 request_sha256 text not null check(request_sha256 ~ '^[a-f0-9]{64}$'),
 created_at timestamptz not null default clock_timestamp() check(isfinite(created_at)),
 constraint payment_intent_body_binding check (
  jsonb_typeof(request_body::jsonb) is not distinct from 'object' and
  (request_body::jsonb->'capture') is not distinct from 'true'::jsonb and
  (request_body::jsonb#>>'{amount,currency}') is not distinct from 'RUB' and
  (request_body::jsonb#>>'{amount,value}') is not distinct from amount::text and
  (request_body::jsonb#>>'{metadata,localPaymentId}') is not distinct from id::text and
  (request_body::jsonb#>>'{metadata,targetId}') is not distinct from target_id::text and
  (request_body::jsonb#>>'{metadata,targetType}') is not distinct from target_type and
  (request_body::jsonb#>>'{metadata,tariffId}') is not distinct from tariff_id)
);
create index payment_intent_owner_idx on app.payment_checkout_intents(owner_id,created_at desc,id desc);
create table app.payment_dispatch_anchors (
 intent_id uuid primary key references app.payment_checkout_intents(id) on delete restrict,
 authorized_at timestamptz not null default clock_timestamp() check(isfinite(authorized_at))
);
create table app.payment_provider_links (
 intent_id uuid primary key references app.payment_dispatch_anchors(intent_id) on delete restrict,
 provider_payment_id uuid not null unique,
 recorded_at timestamptz not null default clock_timestamp() check(isfinite(recorded_at))
);
create function app.reject_payment_intent_mutation() returns trigger
 language plpgsql set search_path='' as $$ begin
 raise exception using errcode='23514',message='Payment intent history is immutable';
end $$;
create function app.stamp_payment_dispatch_anchor() returns trigger
 language plpgsql set search_path='' as $$ begin
 -- The earliest committed authorization is set by the database, never by an app clock.
 new.authorized_at:=pg_catalog.clock_timestamp();return new;
end $$;
create function app.hash_payment_intent() returns trigger
 language plpgsql set search_path='' as $$ begin
 new.request_sha256:=pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(new.request_body,'UTF8')),'hex');return new;
end $$;
create trigger payment_intent_hash before insert on app.payment_checkout_intents
 for each row execute function app.hash_payment_intent();
create trigger payment_intent_immutable before update or delete on app.payment_checkout_intents
 for each row execute function app.reject_payment_intent_mutation();
create trigger payment_dispatch_immutable before update or delete on app.payment_dispatch_anchors
 for each row execute function app.reject_payment_intent_mutation();
create trigger payment_provider_link_immutable before update or delete on app.payment_provider_links
 for each row execute function app.reject_payment_intent_mutation();
create trigger payment_dispatch_stamp before insert on app.payment_dispatch_anchors
 for each row execute function app.stamp_payment_dispatch_anchor();
revoke all on app.payment_checkout_intents,app.payment_dispatch_anchors,app.payment_provider_links from public;
revoke all on function app.reject_payment_intent_mutation(),app.stamp_payment_dispatch_anchor(),app.hash_payment_intent() from public;
commit;
