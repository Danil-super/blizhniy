begin;
set local lock_timeout = '3s';
set local statement_timeout = '10s';
lock table app.payment_fulfillments in access exclusive mode;
do $$ begin
 if exists(select 1 from app.payment_fulfillments) then raise exception 'Refusing to remove nonempty payment fulfillments';end if;
end $$;
drop table app.payment_fulfillments;
drop function app.guard_payment_fulfillment();
commit;
