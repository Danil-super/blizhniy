\set ON_ERROR_STOP on
-- LOCAL OFFLINE PAYMENT LAB ONLY. Not a production Supabase installer/history.
-- auth.users/auth.uid are synthetic; no GoTrue, PostgREST or Storage is started.
do $$ begin
  if current_database() <> 'blizhniy_local_payments' then
    raise exception 'This bootstrap is only for the isolated local payment lab';
  end if;
end $$;
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create schema auth;
create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb default '{}');
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
grant usage on schema public, auth to service_role, anon, authenticated;
\ir schema.sql
\ir rls.sql
grant usage on schema private to service_role;
grant select, insert, update, delete on all tables in schema public to service_role;

-- Reviewed payment dependency manifest, not blind replay of duplicate historical
-- migration timestamps/policy names over the already-consolidated base schema.
\ir migrations/20260619_add_work_request_publication_tariff.sql
\ir migrations/20260619_seed_work_request_publication_tariff.sql
\ir migrations/20260620_harden_job_applications_flow.sql
\ir migrations/20260620_add_work_request_applications_and_notifications.sql
\ir migrations/20260620_zz_harden_application_response_security.sql
\ir migrations/20260624_explicit_public_schema_grants.sql
\ir migrations/20260627_add_ad_marquee_placements.sql
grant select, insert, update, delete on public.ad_marquee_placements to service_role;
\ir migrations/20260925_hide_raw_location_tables.sql
\ir migrations/20260925_restrict_payment_profile_client_grants.sql
\ir migrations/20260926074500_restrict_raw_vacancy_reads.sql
\ir migrations/20260927081944_revoke_unsafe_client_table_privileges_20260927.sql
\ir migrations/20260927084703_revoke_paid_publication_client_writes_20260927.sql
\ir migrations/20261006163000_harden_yookassa_payment_idempotency.sql
\ir migrations/20261007150000_preserve_payment_settlement_state.sql
\ir migrations/20261007180000_apply_payment_fulfillment_atomically.sql
\ir migrations/20261007193251_atomic_ad_marquee_queue.sql
\ir migrations/20261007194452_restore_work_request_within_paid_window.sql
\ir migrations/20261008062202_snapshot_yookassa_checkout_intents.sql
\ir migrations/20261008063110_restore_listing_and_vacancy_within_paid_window.sql

\ir local-reference-data.sql
create schema local_dev;
revoke all on schema local_dev from public, anon, authenticated, service_role;
create table local_dev.bootstrap(fingerprint text primary key, created_at timestamptz not null default now());
insert into local_dev.bootstrap(fingerprint) values (:'local_fingerprint');
