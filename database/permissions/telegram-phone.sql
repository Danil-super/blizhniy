-- Apply explicitly as migration owner after schema review. Existing web role only.
begin;
grant select on app.phone_verification_policy to blizhniy_runtime;
grant select,insert,update(phone,telegram_subject,source,confirmed_at),delete on app.telegram_phone_bindings to blizhniy_runtime;
grant select,insert,update(state,candidate_phone,candidate_subject,token_hash),delete on app.telegram_phone_attempts to blizhniy_runtime;
create policy phone_binding_server on app.telegram_phone_bindings to blizhniy_runtime
 using(user_id=nullif(current_setting('app.phone_user_id',true),'')::uuid)
 with check(user_id=nullif(current_setting('app.phone_user_id',true),'')::uuid);
create policy phone_attempt_server on app.telegram_phone_attempts to blizhniy_runtime
 using(user_id=nullif(current_setting('app.phone_user_id',true),'')::uuid)
 with check(user_id=nullif(current_setting('app.phone_user_id',true),'')::uuid);
grant execute on function app.phone_is_confirmed(uuid),app.normalize_profile_phone(text) to blizhniy_runtime;
commit;
