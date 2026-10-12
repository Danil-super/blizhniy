begin;
set local lock_timeout = '3s';
set local statement_timeout = '10s';
lock table app.mail_outbox in access exclusive mode;
do $$ begin
  if exists(select 1 from app.mail_outbox) then
    raise exception 'Cannot remove delivery state from a nonempty queue' using errcode='55000';
  end if;
end $$;
drop index app.mail_delivery_ready_idx;
drop index app.mail_delivery_lease_idx;
alter table app.mail_outbox drop constraint mail_delivery_state, drop constraint mail_delivery_attempts,
  drop constraint mail_delivery_lease, drop constraint mail_delivery_code,
  drop column state, drop column attempts, drop column available_at,
  drop column claim_id, drop column lease_until, drop column last_code;
commit;
