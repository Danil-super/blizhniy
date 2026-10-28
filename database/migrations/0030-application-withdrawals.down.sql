-- Refuse to forget a user's withdrawal decision. Safe only before first use.
begin;
set local lock_timeout='3s';
set local statement_timeout='10s';
lock table app.application_withdrawals in access exclusive mode;
do $$begin
 if exists(select 1 from app.application_withdrawals) then
  raise exception 'Application withdrawal decisions must be preserved' using errcode='23514';
 end if;
end;$$;
drop table app.application_withdrawals;
drop function app.guard_application_withdrawal();
commit;
