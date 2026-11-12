-- Synthetic provider state only; never install on a production database.
do $$ begin
create schema if not exists local_primary;
create table if not exists local_primary.provider_payments(
 intent_id uuid primary key references app.payment_checkout_intents(id) on delete cascade,
 provider_id uuid unique not null,status text not null check(status in ('pending','succeeded','canceled')),captured_at text);
create table if not exists local_primary.application_deliveries(
 intent_id uuid primary key references app.payment_verifications(intent_id) on delete restrict,
 application_id uuid unique not null references app.applications(id) on delete restrict,
 sent_at timestamptz not null check(isfinite(sent_at)));
end $$;
