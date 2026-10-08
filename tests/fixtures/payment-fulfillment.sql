\set ON_ERROR_STOP on

-- Disposable PostgreSQL17 only. Auth infrastructure is synthetic; the
-- application schema, prerequisite migrations, SQL and row locks are real.
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create schema auth;
create schema private;
create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb default '{}');
create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
create function private.is_admin() returns boolean language sql stable as $$ select false $$;
grant usage on schema public, private, auth to service_role, anon, authenticated;

\ir ../../supabase/schema.sql
\ir ../../supabase/migrations/20260627_add_ad_marquee_placements.sql
\ir ../../supabase/migrations/20261006163000_harden_yookassa_payment_idempotency.sql
\ir ../../supabase/migrations/20261007150000_preserve_payment_settlement_state.sql

grant select, insert, update, delete on all tables in schema public to service_role;
grant select, insert, update, delete on public.listings, public.vacancies, public.work_requests,
  public.fair_applications, public.ad_marquee_placements to authenticated;
\ir ../../supabase/migrations/20260927084703_revoke_paid_publication_client_writes_20260927.sql
\ir ../../supabase/migrations/20260925_restrict_payment_profile_client_grants.sql

alter table public.payments enable row level security;
alter table public.listings enable row level security;
alter table public.vacancies enable row level security;
alter table public.work_requests enable row level security;
alter table public.fair_applications enable row level security;
alter table public.applications enable row level security;
alter table public.notifications enable row level security;

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-000000000001', 'synthetic-a@example.invalid'),
  ('00000000-0000-4000-8000-000000000002', 'synthetic-b@example.invalid');
insert into public.categories (slug, name) values ('synthetic-test-category', 'Synthetic test');

-- These rows truly predate the migration; observation survives per-test cleanup.
insert into public.work_requests (id, author_id, title, description, region_id, city_id, status, published_at)
  select '00000000-0000-4000-8000-000000000900', '00000000-0000-4000-8000-000000000001',
    'Historical synthetic work request', 'Fixture only', region_id, id, 'published', '2020-01-01T12:00:00Z'
  from public.cities limit 1;
insert into public.payments (id, user_id, target_type, target_id, provider, provider_payment_id, amount, status, paid_at)
  values ('00000000-0000-4000-8000-000000000901', '00000000-0000-4000-8000-000000000001',
    'workRequest', '00000000-0000-4000-8000-000000000900', 'yookassa', 'synthetic-historical', 199, 'pending', null);
\if :apply_fulfillment_migration
\ir ../../supabase/migrations/20261007180000_apply_payment_fulfillment_atomically.sql
\endif
create table private.fulfillment_test_migration_observation as
  select to_jsonb(w) work_request, to_jsonb(p) payment
  from public.work_requests w cross join public.payments p
  where w.id = '00000000-0000-4000-8000-000000000900' and p.id = '00000000-0000-4000-8000-000000000901';

-- Capture every physical target UPDATE, including no-op updates, so a legacy
-- guard/replay must prove that it never writes the target at all.
create table private.fulfillment_test_effects (table_name text, target_id uuid);
grant select, insert, delete on private.fulfillment_test_effects to service_role;
create function private.record_fulfillment_test_effect() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  insert into private.fulfillment_test_effects values (tg_table_name, new.id);
  return new;
end;
$$;
do $$
declare table_name text;
begin
  foreach table_name in array array['listings', 'vacancies', 'work_requests',
    'fair_applications', 'applications', 'ad_marquee_placements'] loop
    execute format('create trigger fulfillment_test_effect after update on public.%I '
      'for each row execute function private.record_fulfillment_test_effect()', table_name);
  end loop;
end;
$$;

-- Failure injection is a real transaction error, never a mocked response.
create function private.fail_fulfillment_test_notification() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  raise exception 'synthetic notification insertion failure';
end;
$$;

-- Permitted PostgreSQL BEFORE-trigger semantics: a write can be suppressed
-- without raising an exception. Installed on synthetic fixture rows only.
create function private.suppress_fulfillment_test_write() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  return null;
end;
$$;
