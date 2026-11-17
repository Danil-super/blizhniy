-- Candidate internal payload; never install/run automatically.
-- Restore the original grouping of eight unchanged CHECK expressions after pg_dump.
do $$begin
 if current_database()<>'blizhniy_erasure_test' or current_user<>'postgres' or session_user<>'postgres'
  or current_setting('blizhniy.restore_basic63',true) is distinct from 'owned-basic63'
 then raise exception 'Owned basic63 restore required' using errcode='BR063';end if;
alter table app.users drop constraint users_email_check,
 add constraint users_email_check check(char_length(email) between 3 and 254 and email=lower(btrim(email)) and email ~ '^[^[:space:]@]+@[^[:space:]@]+$');
alter table app.email_confirmations drop constraint email_confirmations_email_check,
 add constraint email_confirmations_email_check check(char_length(email) between 3 and 254 and email=lower(btrim(email)));
alter table app.password_recoveries drop constraint password_recoveries_email_check,
 add constraint password_recoveries_email_check check(char_length(email) between 3 and 254 and email=lower(btrim(email)) and email ~ '^[^[:space:]@]+@[^[:space:]@]+$');
alter table app.mail_outbox drop constraint mail_outbox_payload_check,
 add constraint mail_outbox_payload_check check(octet_length(payload) between 30 and 2048 and get_byte(payload,0)=1);
alter table app.telegram_phone_bindings drop constraint telegram_phone_bindings_telegram_subject_check,
 add constraint telegram_phone_bindings_telegram_subject_check check(char_length(telegram_subject) between 1 and 128 and telegram_subject !~ '[[:space:][:cntrl:]]');
alter table app.telegram_phone_attempts drop constraint telegram_phone_attempts_candidate_subject_check,
 add constraint telegram_phone_attempts_candidate_subject_check check(char_length(candidate_subject) between 1 and 128 and candidate_subject !~ '[[:space:][:cntrl:]]');
alter table app_admin.user_changes drop constraint user_changes_reason_check,
 add constraint user_changes_reason_check check(char_length(reason) between 3 and 500 and reason=btrim(reason)
  and reason !~ U&'[\0001-\001F\007F-\009F\061C\200E\200F\202A-\202E\2066-\2069]');
alter table app_admin.tariff_changes drop constraint tariff_changes_reason_check,
 add constraint tariff_changes_reason_check check(char_length(reason) between 3 and 500 and reason=btrim(reason));
end$$;
