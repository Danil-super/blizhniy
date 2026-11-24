-- Apply explicitly as the production database owner. Login and credentials are provisioned separately.
begin;
set local lock_timeout='3s';
set local statement_timeout='10s';

do $$ begin
 if current_database()<>'blizhniy_prod' or current_user<>session_user
  or not exists(select 1 from pg_database where datname=current_database() and datdba=(current_user::regrole)::oid)
  or (select count(*) from pg_namespace where nspname in ('app','app_stats') and nspowner=(current_user::regrole)::oid)<>2
  or (select count(*) from pg_class where oid in ('app.telegram_phone_bindings'::regclass,'app.telegram_phone_attempts'::regclass)
   and relowner=(current_user::regrole)::oid and relrowsecurity and not relforcerowsecurity)<>2 then
  raise exception 'Account export requires the reviewed database owner and phone policies';
 end if;
end $$;

create role blizhniy_account_export_reader nologin noinherit nocreatedb nocreaterole connection limit 1;
alter role blizhniy_account_export_reader in database blizhniy_prod set default_transaction_read_only=on;
grant connect on database blizhniy_prod to blizhniy_account_export_reader;

grant usage on schema app to blizhniy_account_export_reader;
grant select(user_id,scope,created_at,expires_at,last_seen_at) on app.sessions to blizhniy_account_export_reader;
grant select(user_id,profile) on app.cabinet_profiles to blizhniy_account_export_reader;
grant select(user_id,document,version,recorded_at) on app.registration_legal to blizhniy_account_export_reader;
grant select(user_id,created_at,expires_at) on app.email_confirmations,app.password_recoveries to blizhniy_account_export_reader;
grant select(user_id,id,purpose,state,created_at,expires_at) on app.mail_outbox to blizhniy_account_export_reader;
grant select(id,author_id,listing_type,category_id,city_id,title,description,price,district,address,latitude,longitude,
 show_exact_address,contact_phone,messenger_url,contact_method,booking,status,is_paid,view_count,revision,created_at,updated_at,published_at,expires_at)
 on app.listings to blizhniy_account_export_reader;
grant select(id,author_id,kind,form,city_id,profession_id,revision,status,is_paid,created_at,updated_at,published_at,expires_at,deleted_at)
 on app.work_publications,app.service_publications to blizhniy_account_export_reader;
grant select(listing_id,revision,state,submitted_at,decided_at,decision_note) on app.listing_moderation to blizhniy_account_export_reader;
grant select(publication_id,revision,state,submitted_at,decided_at,decision_note)
 on app.work_moderation,app.service_moderation to blizhniy_account_export_reader;
grant select(listing_id,blocked_revision,reason,blocked_at) on app.listing_blocks to blizhniy_account_export_reader;
grant select(listing_id,owner_id,removed_revision,removed_at) on app.listing_owner_removals to blizhniy_account_export_reader;
grant select(publication_id,owner_id,kind,expected_revision,action,reason,resulting_revision,status,occurred_at)
 on app.work_owner_actions to blizhniy_account_export_reader;
grant select(id,applicant_id,work_publication_id,specialist_publication_id,message,snapshot,status,is_paid,sent_at,created_at,updated_at,revision)
 on app.applications to blizhniy_account_export_reader;
grant select(application_id,owner_id,withdrawn_revision,withdrawn_at) on app.application_withdrawals to blizhniy_account_export_reader;
grant select(id,listing_id,guest_id,host_id,mode,start_date,end_date,guests,total,status,revision,created_at,updated_at,decided_at,starts_at,expires_at,cancelled_by,cancellation_reason)
 on app.booking_requests to blizhniy_account_export_reader;
grant select(booking_id,revision,status,actor_id,reason,origin,created_at) on app.booking_events to blizhniy_account_export_reader;
grant select(id,owner_id,target_type,target_id,tariff_id,amount,duration_days,is_test,created_at)
 on app.payment_checkout_intents to blizhniy_account_export_reader;
grant select(id,owner_id,status) on app.payment_orders to blizhniy_account_export_reader;
grant select(intent_id,status,captured_at) on app.payment_verifications to blizhniy_account_export_reader;
grant select(intent_id,fulfilled_at) on app.payment_fulfillments to blizhniy_account_export_reader;
grant select(id,user_id,category,tone,title,body,action_href,read_at,dismissed_at,created_at) on app.notifications to blizhniy_account_export_reader;
grant select(id,user_id,status,revision,requested_at,review_started_at,resolved_at,resolution)
 on app.account_deletion_requests to blizhniy_account_export_reader;
grant select(id,request_id,actor_id,status,resolution,created_at)
 on app.account_deletion_events to blizhniy_account_export_reader;
grant select(id,owner_id,mime_type,width,height,size,sha256,state,created_at,ready_at) on app.media_objects to blizhniy_account_export_reader;
grant select(listing_id,media_id,position) on app.listing_photos to blizhniy_account_export_reader;
grant select(publication_id,media_id,position) on app.work_publication_photos,app.service_publication_photos to blizhniy_account_export_reader;
do $$
begin
 if to_regclass('app.application_contact_views') is not null then
  grant select(application_id,recipient_id,evidence,recorded_at) on app.application_contact_views to blizhniy_account_export_reader;
 end if;
 if to_regclass('app.application_selection_events') is not null then
  grant select(application_id,recipient_id,selected_at) on app.application_selection_events to blizhniy_account_export_reader;
 end if;
 if to_regclass('app.payment_checkout_cancellations') is not null then
  grant select(payment_id,owner_id,target_type,cancelled_at) on app.payment_checkout_cancellations to blizhniy_account_export_reader;
 end if;
 if to_regclass('app.payment_refund_reservations') is not null then
  grant select(id,payment_intent_id,amount,created_at) on app.payment_refund_reservations to blizhniy_account_export_reader;
  grant select(operation_id,status,observed_at) on app.payment_refund_observations to blizhniy_account_export_reader;
 end if;
 if to_regclass('app.payment_renewals') is not null then
  grant select(intent_id,previous_intent_id,additional_starts_at,additional_expires_at,recorded_at)
   on app.payment_renewals to blizhniy_account_export_reader;
 end if;
 if to_regclass('app.media_retirement_requests') is not null then
  grant select(media_id,requested_at) on app.media_retirement_requests to blizhniy_account_export_reader;
  grant select(media_id,completed_at) on app.media_retirement_completions to blizhniy_account_export_reader;
 end if;
end
$$;

create schema app_export;
revoke all on schema app_export from public;
grant usage on schema app_export to blizhniy_account_export_reader;

create function app_export.approved_account(session_digest text,subject_id uuid,operator_id uuid)
returns table(id uuid,email text,is_blocked boolean,email_verified_at timestamptz,created_at timestamptz)
language sql stable strict security definer set search_path=pg_catalog,pg_temp as $$
 select u.id,u.email,u.is_blocked,u.email_verified_at,u.created_at from app.users u
 where u.id=subject_id and u.email_verified_at is not null and subject_id<>operator_id
  and exists(select 1 from app.sessions s join app.users actor on actor.id=s.user_id and actor.auth_version=s.auth_version
   where actor.id=operator_id and actor.role='admin' and not actor.is_blocked and actor.email_verified_at is not null
    and s.token_hash=session_digest and s.scope='app' and s.expires_at>statement_timestamp()
    and s.last_seen_at>statement_timestamp()-interval '30 minutes')
$$;

-- Owner checks stay in app_export so the live Telegram RLS policies remain intact.
create function app_export.phone_bindings(session_digest text,subject_id uuid,operator_id uuid)
returns table(phone text,source text,confirmed_at timestamptz)
language sql stable strict security definer set search_path=pg_catalog,pg_temp as $$
 select b.phone,b.source,b.confirmed_at from app.telegram_phone_bindings b
 join app_export.approved_account(session_digest,subject_id,operator_id) a on a.id=b.user_id
 order by b.confirmed_at
$$;

create function app_export.phone_attempts(session_digest text,subject_id uuid,operator_id uuid)
returns table(state text,created_at timestamptz,expires_at timestamptz)
language sql stable strict security definer set search_path=pg_catalog,pg_temp as $$
 select p.state,p.created_at,p.expires_at from app.telegram_phone_attempts p
 join app_export.approved_account(session_digest,subject_id,operator_id) a on a.id=p.user_id
 order by p.created_at,p.id
$$;

create function app_export.match_listing_views(ids uuid[], digests bytea[])
returns table(listing_id uuid)
language sql stable strict security definer set search_path=pg_catalog,pg_temp as $$
 select v.listing_id
 from unnest(ids,digests) as candidate(id,digest)
 join app_stats.listing_views v on v.listing_id=candidate.id and v.viewer_digest=candidate.digest
 where cardinality(ids) between 1 and 500 and cardinality(ids)=cardinality(digests)
 order by v.listing_id
$$;
revoke all on all functions in schema app_export from public;
grant execute on all functions in schema app_export to blizhniy_account_export_reader;

-- Default grants on the owning role must not expose this lookup.
do $$ begin
 if exists (
  select 1 from (
   select nspowner as owner,nspacl as grants from pg_namespace where nspname='app_export'
   union all
   select proowner,proacl from pg_proc where pronamespace='app_export'::regnamespace
  ) objects cross join lateral aclexplode(grants) acl
  where acl.grantee<>objects.owner
   and (acl.grantee<>'blizhniy_account_export_reader'::regrole or acl.is_grantable or acl.grantor<>objects.owner)
 ) then raise exception 'Unexpected account export permissions'; end if;
end $$;
commit;
