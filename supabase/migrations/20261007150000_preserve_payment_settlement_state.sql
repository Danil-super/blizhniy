-- Settlement facts are monotonic, including across independent/stale requests.
-- Apply before deploying the updater that consumes RETURNING representation.
create schema if not exists private;

create or replace function private.preserve_payment_settlement_state()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  -- A genuine refund may follow success; a stale provider response may undo
  -- neither a success nor a refund.
  if old.status = 'refunded'
    or (old.status = 'succeeded' and new.status <> 'refunded') then
    new.status := old.status;
  end if;

  if old.paid_at is not null then
    new.paid_at := old.paid_at;
  elsif new.status = 'succeeded' then
    new.paid_at := coalesce(new.paid_at, pg_catalog.statement_timestamp());
  end if;

  if old.target_applied_at is not null then
    new.target_applied_at := old.target_applied_at;
  end if;

  return new;
end;
$$;

revoke all on function private.preserve_payment_settlement_state() from public, anon, authenticated;
grant execute on function private.preserve_payment_settlement_state() to service_role;

drop trigger if exists preserve_payment_settlement_state on public.payments;
create trigger preserve_payment_settlement_state
before update on public.payments
for each row execute function private.preserve_payment_settlement_state();
