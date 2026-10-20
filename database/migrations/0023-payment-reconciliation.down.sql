begin;
set local lock_timeout='3s';
set local statement_timeout='10s';
do $$ begin
 if exists(select 1 from app.payment_reconciliation_jobs) then
  raise exception 'Refusing to remove nonempty payment reconciliation work';
 end if;
end $$;
drop table app.payment_reconciliation_jobs;
drop function app.guard_payment_reconciliation_job();
commit;
