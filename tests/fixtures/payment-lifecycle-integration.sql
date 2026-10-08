\set ON_ERROR_STOP on

-- Disposable PostgreSQL17 only: Auth infrastructure is synthetic, not GoTrue.
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create schema auth;
create schema private;
create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb default '{}');
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
grant usage on schema public, private, auth to service_role, anon, authenticated;
\ir ../../supabase/schema.sql
\ir ../../supabase/rls.sql
grant select, insert, update, delete on all tables in schema public to service_role;

-- Explicit dependency manifest, chronological within this reviewed scope.
-- This is NOT a reconstruction of production Supabase migration history.
\ir ../../supabase/migrations/20260619_add_work_request_publication_tariff.sql
\ir ../../supabase/migrations/20260619_seed_work_request_publication_tariff.sql
\ir ../../supabase/migrations/20260624_explicit_public_schema_grants.sql
\ir ../../supabase/migrations/20260627_add_ad_marquee_placements.sql
grant select, insert, update, delete on public.ad_marquee_placements to service_role;
\ir ../../supabase/migrations/20260925_hide_raw_location_tables.sql
\ir ../../supabase/migrations/20260925_restrict_payment_profile_client_grants.sql
\ir ../../supabase/migrations/20260926074500_restrict_raw_vacancy_reads.sql
\ir ../../supabase/migrations/20260927081944_revoke_unsafe_client_table_privileges_20260927.sql
\ir ../../supabase/migrations/20260927084703_revoke_paid_publication_client_writes_20260927.sql
\ir ../../supabase/migrations/20261006163000_harden_yookassa_payment_idempotency.sql
\ir ../../supabase/migrations/20261007150000_preserve_payment_settlement_state.sql

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-000000000001', 'synthetic-a@example.invalid'),
  ('00000000-0000-4000-8000-000000000002', 'synthetic-b@example.invalid');
insert into public.categories (id, slug, name)
  values ('00000000-0000-4000-8000-000000000003', 'synthetic-integration', 'Synthetic integration');
-- These rows genuinely precede all new entitlement/checkout blocks.
insert into public.work_requests (id, author_id, title, description, region_id, city_id, status, published_at)
  select '00000000-0000-4000-8000-000000000900', '00000000-0000-4000-8000-000000000001',
    'Historical fixture', 'Synthetic history', region_id, id, 'published', '2020-01-01T12:00:00Z'
  from public.cities limit 1;
insert into public.payments (id, user_id, target_type, target_id, provider, provider_payment_id, amount, status)
  values ('00000000-0000-4000-8000-000000000901', '00000000-0000-4000-8000-000000000001',
    'workRequest', '00000000-0000-4000-8000-000000000900', 'yookassa', 'synthetic-historical', 199, 'succeeded');
create table private.integration_history_before as
  select to_jsonb(w) work_request, to_jsonb(p) payment from public.work_requests w cross join public.payments p;

\ir ../../supabase/migrations/20261007180000_apply_payment_fulfillment_atomically.sql
\ir ../../supabase/migrations/20261007193251_atomic_ad_marquee_queue.sql
\ir ../../supabase/migrations/20261007194452_restore_work_request_within_paid_window.sql
\ir ../../supabase/migrations/20261008062202_snapshot_yookassa_checkout_intents.sql
\ir ../../supabase/migrations/20261008063110_restore_listing_and_vacancy_within_paid_window.sql
create table private.integration_history_after as
  select to_jsonb(w) work_request, to_jsonb(p) payment from public.work_requests w cross join public.payments p;
grant select on private.integration_history_before, private.integration_history_after to service_role;

-- Test instrumentation only: no business eligibility implementation is copied.
create table private.integration_effects (table_name text, target_id uuid, operation text);
grant select, insert, delete on private.integration_effects to service_role;
create function private.record_integration_effect() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  insert into private.integration_effects values (tg_table_name, new.id, tg_op);
  return new;
end;
$$;
do $$
declare table_name text;
begin
  foreach table_name in array array['listings', 'vacancies', 'work_requests', 'fair_applications',
    'applications', 'ad_marquee_placements'] loop
    execute format('create trigger integration_effect after update on public.%I '
      'for each row execute function private.record_integration_effect()', table_name);
  end loop;
end;
$$;
create trigger integration_effect after insert on public.notifications
for each row execute function private.record_integration_effect();
create function private.fail_integration_notification() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  raise exception 'synthetic integration notification failure';
end;
$$;
