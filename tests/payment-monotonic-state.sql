\set ON_ERROR_STOP on
\if :{?keep_payment_fixture}
\else
\set keep_payment_fixture false
\endif

-- This fixture is only for a disposable, empty local PostgreSQL database.
begin;
create role anon nologin;
create role authenticated nologin;
create role service_role nologin;
create schema private;
create table public.payments (
  id uuid primary key,
  status text not null,
  paid_at timestamptz,
  target_applied_at timestamptz,
  provider text not null,
  provider_payment_id text
);
grant select, insert, update on public.payments to service_role;

\if :apply_payment_guard
\ir ../supabase/migrations/20261007150000_preserve_payment_settlement_state.sql
\endif

set local role service_role;
insert into public.payments (id, status, provider, provider_payment_id)
values ('11111111-1111-4111-8111-111111111111', 'pending', 'yookassa', 'synthetic-provider-id');

update public.payments
set status = 'succeeded', paid_at = '2026-09-01T12:34:56.789Z', target_applied_at = '2026-09-01T12:35:00.123Z';
-- A freshly loaded success replay must not move the purchased interval.
update public.payments set paid_at = '2026-10-07T15:00:00Z';
-- A pending snapshot can finish after the successful transaction.
update public.payments set status = 'pending', paid_at = null, target_applied_at = null;

do $$
declare payment public.payments%rowtype;
begin
  select * into payment from public.payments;
  if payment.status <> 'succeeded'
    or payment.paid_at is distinct from '2026-09-01T12:34:56.789Z'::timestamptz
    or payment.target_applied_at is distinct from '2026-09-01T12:35:00.123Z'::timestamptz then
    raise exception 'A replay/stale snapshot changed established settlement state: %', row_to_json(payment);
  end if;
end;
$$;

-- A real refund is allowed, but a later stale success cannot undo it.
update public.payments set status = 'refunded';
update public.payments set status = 'succeeded', paid_at = now(), target_applied_at = null;
do $$
begin
  if (select status from public.payments) <> 'refunded' then
    raise exception 'A stale success undid a refund';
  end if;
end;
$$;
reset role;

do $$
begin
  if has_function_privilege('anon', 'private.preserve_payment_settlement_state()', 'execute')
    or has_function_privilege('authenticated', 'private.preserve_payment_settlement_state()', 'execute') then
    raise exception 'Browser roles obtained trigger function execution privileges';
  end if;
end;
$$;
\if :keep_payment_fixture
commit;
\else
rollback;
\endif
