begin;
set local lock_timeout='3s';
set local statement_timeout='10s';

lock table app.notifications in access exclusive mode;
lock table notification_delivery.business_email in access exclusive mode;
do $$
begin
 if exists(select 1 from notification_delivery.business_email) then
  raise exception 'Business email journal is not empty';
 end if;
end $$;
drop trigger enqueue_business_email on app.notifications;
drop function notification_delivery.enqueue_business_email();
drop function notification_delivery.claim_business_email(uuid);
drop function notification_delivery.finish_business_email(uuid,uuid,text);
drop function notification_delivery.sweep_business_email();
drop function notification_delivery.business_email_recipient(uuid);
drop table notification_delivery.business_email;
drop schema notification_delivery;
commit;
