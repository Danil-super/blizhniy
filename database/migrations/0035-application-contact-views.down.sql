-- Operator-only empty-schema rollback. Evidence must never be silently erased.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '10s';
do $$ begin
 if exists(select 1 from app.application_contact_views) then
  raise exception using errcode='23514',message='Application contact evidence must be retained';
 end if;
end $$;
drop trigger application_view_decision on app.applications;
drop function app.record_application_view_decision();
drop trigger application_contact_view_guard on app.application_contact_views;
drop function app.guard_application_contact_view();
drop table app.application_contact_views;
commit;
