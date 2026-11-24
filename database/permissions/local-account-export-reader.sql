-- Disposable PostgreSQL integration fixture. The test enables LOGIN in its container.
begin;
do $$
begin
 if current_database()<>'blizhniy_test' or current_user<>'postgres' or session_user<>'postgres' then
  raise exception 'Account export grants require the disposable test database';
 end if;
end
$$;
create role blizhniy_local_export_reader nologin noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
grant connect on database blizhniy_test to blizhniy_local_export_reader;
grant usage on schema app to blizhniy_local_export_reader;
grant select(id,email,is_blocked,email_verified_at,created_at,auth_version) on app.users to blizhniy_local_export_reader;
grant select(token_hash,user_id,auth_version,scope,created_at,expires_at,last_seen_at) on app.sessions to blizhniy_local_export_reader;
grant select(user_id,profile) on app.cabinet_profiles to blizhniy_local_export_reader;
grant select(user_id,document,version,recorded_at) on app.registration_legal to blizhniy_local_export_reader;
grant select(user_id,created_at,expires_at) on app.email_confirmations,app.password_recoveries to blizhniy_local_export_reader;
grant select(user_id,phone,source,confirmed_at) on app.telegram_phone_bindings to blizhniy_local_export_reader;
grant select(user_id,id,state,created_at,expires_at) on app.telegram_phone_attempts to blizhniy_local_export_reader;
create policy local_export_phone_owner on app.telegram_phone_bindings for select to blizhniy_local_export_reader
 using(user_id=nullif(current_setting('blizhniy.account_export_owner',true),'')::uuid);
create policy local_export_phone_owner on app.telegram_phone_attempts for select to blizhniy_local_export_reader
 using(user_id=nullif(current_setting('blizhniy.account_export_owner',true),'')::uuid);
grant select(user_id,id,purpose,state,created_at,expires_at) on app.mail_outbox to blizhniy_local_export_reader;
grant select(id,author_id,listing_type,category_id,city_id,title,description,price,district,address,latitude,longitude,
 show_exact_address,contact_phone,messenger_url,contact_method,booking,status,is_paid,view_count,revision,created_at,updated_at,published_at,expires_at)
 on app.listings to blizhniy_local_export_reader;
grant select(id,author_id,kind,form,city_id,profession_id,revision,status,is_paid,created_at,updated_at,published_at,expires_at,deleted_at)
 on app.work_publications,app.service_publications to blizhniy_local_export_reader;
grant select(listing_id,revision,state,submitted_at,decided_at,decision_note) on app.listing_moderation to blizhniy_local_export_reader;
grant select(publication_id,revision,state,submitted_at,decided_at,decision_note)
 on app.work_moderation,app.service_moderation to blizhniy_local_export_reader;
grant select(listing_id,blocked_revision,reason,blocked_at) on app.listing_blocks to blizhniy_local_export_reader;
grant select(listing_id,owner_id,removed_revision,removed_at) on app.listing_owner_removals to blizhniy_local_export_reader;
grant select(publication_id,owner_id,kind,expected_revision,action,reason,resulting_revision,status,occurred_at)
 on app.work_owner_actions to blizhniy_local_export_reader;
grant select(id,applicant_id,work_publication_id,specialist_publication_id,message,snapshot,status,is_paid,sent_at,created_at,updated_at,revision)
 on app.applications to blizhniy_local_export_reader;
grant select(application_id,owner_id,withdrawn_revision,withdrawn_at) on app.application_withdrawals to blizhniy_local_export_reader;
grant select(id,listing_id,guest_id,host_id,mode,start_date,end_date,guests,total,status,revision,created_at,updated_at,decided_at,starts_at,expires_at,cancelled_by,cancellation_reason)
 on app.booking_requests to blizhniy_local_export_reader;
grant select(booking_id,revision,status,actor_id,reason,origin,created_at) on app.booking_events to blizhniy_local_export_reader;
grant select(id,owner_id,target_type,target_id,tariff_id,amount,duration_days,is_test,created_at)
 on app.payment_checkout_intents to blizhniy_local_export_reader;
grant select(id,owner_id,status) on app.payment_orders to blizhniy_local_export_reader;
grant select(intent_id,status,captured_at) on app.payment_verifications to blizhniy_local_export_reader;
grant select(intent_id,fulfilled_at) on app.payment_fulfillments to blizhniy_local_export_reader;
grant select(id,user_id,category,tone,title,body,action_href,read_at,created_at) on app.notifications to blizhniy_local_export_reader;
grant select(id,user_id,status,revision,requested_at,review_started_at,resolved_at,resolution)
 on app.account_deletion_requests to blizhniy_local_export_reader;
grant select(id,owner_id,mime_type,width,height,size,sha256,state,created_at,ready_at) on app.media_objects to blizhniy_local_export_reader;
grant select(listing_id,media_id,position) on app.listing_photos to blizhniy_local_export_reader;
grant select(publication_id,media_id,position) on app.work_publication_photos,app.service_publication_photos to blizhniy_local_export_reader;
do $$
begin
 if to_regclass('app_stats.listing_views') is not null then
  grant usage on schema app_stats to blizhniy_local_export_reader;
  grant select(listing_id,viewer_digest) on app_stats.listing_views to blizhniy_local_export_reader;
 end if;
 if to_regclass('app.application_contact_views') is not null then
  grant select(application_id,recipient_id,evidence,recorded_at) on app.application_contact_views to blizhniy_local_export_reader;
 end if;
 if to_regclass('app.application_selection_events') is not null then
  grant select(application_id,recipient_id,selected_at) on app.application_selection_events to blizhniy_local_export_reader;
 end if;
 if to_regclass('app.payment_checkout_cancellations') is not null then
  grant select(payment_id,owner_id,target_type,cancelled_at) on app.payment_checkout_cancellations to blizhniy_local_export_reader;
 end if;
 if to_regclass('app.payment_refund_reservations') is not null then
  grant select(id,payment_intent_id,amount,created_at) on app.payment_refund_reservations to blizhniy_local_export_reader;
  grant select(operation_id,status,observed_at) on app.payment_refund_observations to blizhniy_local_export_reader;
 end if;
 if to_regclass('app.payment_renewals') is not null then
  grant select(intent_id,previous_intent_id,additional_starts_at,additional_expires_at,recorded_at)
   on app.payment_renewals to blizhniy_local_export_reader;
 end if;
 if to_regclass('app.media_retirement_requests') is not null then
  grant select(media_id,requested_at) on app.media_retirement_requests to blizhniy_local_export_reader;
  grant select(media_id,completed_at) on app.media_retirement_completions to blizhniy_local_export_reader;
 end if;
end
$$;
commit;
