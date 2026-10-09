\set ON_ERROR_STOP on
-- LOCAL FULL SUPABASE ONLY: uses real GoTrue/Storage, never creates fake Auth.
do $$ begin
  if current_database() <> 'postgres'
     or to_regclass('auth.users') is null
     or to_regclass('storage.buckets') is null then
    raise exception 'Local Supabase Auth and Storage must be initialized first';
  end if;
end $$;
set search_path = public, extensions;
\ir schema.sql
\ir rls.sql
grant usage on schema private to service_role;
grant select, insert, update, delete on all tables in schema public to service_role;
\ir migrations/20260617_grant_private_role_helper_rls_execute.sql
\ir migrations/20260618_extend_vacancy_details_and_images.sql
\ir migrations/20260619_add_work_request_publication_tariff.sql
\ir migrations/20260619_seed_work_request_publication_tariff.sql
\ir migrations/20260620_harden_job_applications_flow.sql
\ir migrations/20260620_add_work_request_applications_and_notifications.sql
\ir migrations/20260620_zz_harden_application_response_security.sql
\ir migrations/20260621_add_listing_booking_details.sql
\ir migrations/20260621_add_booking_requests.sql
\ir migrations/20260624_explicit_public_schema_grants.sql
\ir migrations/20260625_add_listing_view_counts.sql
\ir migrations/20260627_add_ad_marquee_placements.sql
grant select, insert, update, delete on public.ad_marquee_placements to service_role;
\ir migrations/20260710_add_work_request_images.sql
\ir migrations/20260925_hide_raw_location_tables.sql
\ir migrations/20260925_restrict_payment_profile_client_grants.sql
\ir migrations/20260925_restrict_booking_client_writes.sql
\ir migrations/20260926072813_lock_unpaid_specialist_activation_20260926.sql
\ir migrations/20260926072901_grant_specialist_guard_service_role_20260926.sql
\ir migrations/20260926074136_restrict_public_listing_view_rpc_20260926.sql
\ir migrations/20260926074500_restrict_raw_vacancy_reads.sql
\ir migrations/20260927080912_private_cabinet_profiles_20260927.sql
\ir migrations/20260927080926_account_deletion_request_intake_20260927.sql
\ir migrations/20260927081011_record_registration_legal_events_20260927.sql
\ir migrations/20260927081111_booking_inventory_bounds_20260927.sql
\ir migrations/20260927081944_revoke_unsafe_client_table_privileges_20260927.sql
\ir migrations/20260927082317_add_ad_marquee_payment_fk_index_20260927.sql
\ir migrations/20260927082405_relocate_btree_gist_extension_20260927.sql
\ir migrations/20260927083242_account_deletion_requests_detach_deleted_user_20260927.sql
\ir migrations/20260927084703_revoke_paid_publication_client_writes_20260927.sql
\ir migrations/20260927085014_revoke_public_browser_maintain_privilege_20260927.sql
\ir migrations/20260927085309_revoke_unused_org_profile_client_writes_20260927.sql
\ir migrations/20261006163000_harden_yookassa_payment_idempotency.sql
\ir migrations/20261007150000_preserve_payment_settlement_state.sql
\ir migrations/20261007180000_apply_payment_fulfillment_atomically.sql
\ir migrations/20261007193251_atomic_ad_marquee_queue.sql
\ir migrations/20261007194452_restore_work_request_within_paid_window.sql
\ir migrations/20261008062202_snapshot_yookassa_checkout_intents.sql
\ir migrations/20261008063110_restore_listing_and_vacancy_within_paid_window.sql
\ir migrations/20260615_create_public_media_storage_bucket.sql
\ir migrations/20260615_ensure_public_media_bucket_safe_access.sql
\ir migrations/20260615_remove_public_media_bucket_listing_policy.sql
\ir local-reference-data.sql
revoke execute on function public.handle_new_user() from public, anon, authenticated;
create schema local_dev;
revoke all on schema local_dev from public, anon, authenticated, service_role;
create table local_dev.bootstrap(fingerprint text primary key, created_at timestamptz not null default now());
insert into local_dev.bootstrap(fingerprint) values (:'local_fingerprint');
notify pgrst, 'reload schema';
