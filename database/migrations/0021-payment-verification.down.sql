begin;
set local lock_timeout = '3s';
set local statement_timeout = '10s';
lock table app.payment_verifications in access exclusive mode;
do $$ begin
 if exists(select 1 from app.payment_verifications) then raise exception 'Refusing to remove nonempty payment verifications';end if;
end $$;
drop table app.payment_verifications;
drop function app.guard_payment_verification();
alter table app.payment_provider_links drop constraint payment_provider_verification_binding;
commit;
