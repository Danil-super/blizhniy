begin;
set local lock_timeout = '3s';
set local statement_timeout = '10s';
lock table app.payment_orders in access exclusive mode;
do $$ begin
 if exists(select 1 from app.payment_orders) then raise exception 'Refusing to remove nonempty payment orders';end if;
end $$;
drop table app.payment_orders;
drop function app.guard_payment_order();
alter table app.payment_checkout_intents drop constraint payment_intent_order_binding;
commit;
