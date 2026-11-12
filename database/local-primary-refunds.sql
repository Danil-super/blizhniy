-- Synthetic provider state only. No runtime-role grants or app foreign keys.
create table if not exists local_primary.provider_refunds(
 idempotence_key text primary key check(idempotence_key ~ '^refund-[a-f0-9-]{36}$'),
 provider_id uuid not null unique,
 payment_id uuid not null unique references local_primary.provider_payments(provider_id) on delete restrict,
 request_body text not null check(octet_length(request_body)<=4096),
 created_at timestamptz not null default clock_timestamp() check(isfinite(created_at)));
