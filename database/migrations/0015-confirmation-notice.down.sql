begin;
set local lock_timeout='3s';
set local statement_timeout='10s';
-- Validating the restored constraint refuses rollback while notices remain; never delete mail to force it.
alter table app.mail_outbox drop constraint mail_outbox_purpose_check;
alter table app.mail_outbox add constraint mail_outbox_purpose_check
  check (purpose in ('confirm','recover','reset_notice'));
commit;
