begin;
set local lock_timeout = '3s';
set local statement_timeout = '10s';
lock table app.applications,app.booking_requests,app.notifications in access exclusive mode;
do $$ begin
 if exists(select 1 from app.applications) or exists(select 1 from app.booking_requests) or exists(select 1 from app.notifications) then
  raise exception 'Refusing to remove nonempty interactions';
 end if;
end $$;
drop table app.notifications;
drop table app.booking_requests;
drop table app.applications;
commit;
