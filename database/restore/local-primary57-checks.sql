-- Internal payload of restore-local-primary57-checks.mjs, not a migration/CLI.
-- pg_dump deparses BETWEEN into AND; restore reparses it with different grouping.
do $$begin
 if current_database()<>'blizhniy_prod' or current_user<>'postgres' or session_user<>'postgres'
  or current_setting('blizhniy.restore_drill',true) is distinct from 'owned-local57'
  or (select count(*) from blizhniy_meta.migrations)<>57
  or (select max(name) from blizhniy_meta.migrations)<>'0057-service-payment-terms.sql'
  or (select pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
   pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(name,sha256) order by name collate "C")::text,'UTF8')),'hex')
   from blizhniy_meta.migrations) is distinct from '3bc82aab7efd3e4f4271d3edc19f0b3bdd1f0251b051e2b581c1226b3f322ddf'
 then raise exception 'Owned local57 restore required' using errcode='BR057';end if;
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
end$$;
