begin;
set local lock_timeout='3s';
set local statement_timeout='10s';
do $$ begin
 if exists(select 1 from app.telegram_phone_bindings) or exists(select 1 from app.telegram_phone_attempts)
  or exists(select 1 from app.phone_verification_policy where available or required) then
  raise exception 'Phone verification rollback requires an explicit data-retention decision';
 end if;
end $$;
drop trigger listing_phone_publication on app.listings;
drop trigger work_phone_publication on app.work_publications;
drop trigger service_phone_publication on app.service_publications;
drop trigger checkout_phone_required on app.payment_checkout_intents;
drop function app.guard_phone_checkout();
drop trigger cabinet_profile_phone on app.cabinet_profiles;
drop function app.guard_profile_phone();
drop function app.guard_phone_publication();
drop table app.telegram_phone_attempts;
drop function app.guard_phone_attempt();
drop function app.phone_is_confirmed(uuid);
drop function app.normalize_profile_phone(text);
drop table app.telegram_phone_bindings;
drop table app.phone_verification_policy;
commit;
