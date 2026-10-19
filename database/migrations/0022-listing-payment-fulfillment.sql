-- Once-only receipt, private to a future trusted worker. No grants or automatic cutover.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '10s';
create table app.payment_fulfillments (
 intent_id uuid primary key references app.payment_verifications(intent_id) on delete restrict,
 published_at timestamptz not null check(isfinite(published_at)),
 expires_at timestamptz not null check(isfinite(expires_at) and expires_at>published_at),
 fulfilled_at timestamptz not null default clock_timestamp() check(isfinite(fulfilled_at))
);
create function app.guard_payment_fulfillment() returns trigger
 language plpgsql set search_path='' as $$ begin
 if tg_op<>'INSERT' then
  raise exception using errcode='23514',message='Payment fulfillment history is immutable';
 end if;
 new.fulfilled_at:=pg_catalog.clock_timestamp();return new;
end $$;
create trigger payment_fulfillment_guard before insert or update or delete on app.payment_fulfillments
 for each row execute function app.guard_payment_fulfillment();
revoke all on app.payment_fulfillments from public;
revoke all on function app.guard_payment_fulfillment() from public;
commit;
