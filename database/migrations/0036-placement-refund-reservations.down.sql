-- Empty-schema rollback only. Never erase an operation key or financial reservation.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '10s';
lock table app.payment_fulfillments,app.payment_refund_reservations in access exclusive mode;
do $$ begin
 if exists(select 1 from app.payment_refund_reservations) then
  raise exception using errcode='23514',message='Refund reservations must be retained';
 end if;
end $$;
drop trigger payment_refund_fulfillment_fence on app.payment_fulfillments;
drop function app.fence_refunded_payment_fulfillment();
drop table app.payment_refund_reservations;
drop function app.guard_placement_refund_reservation();
commit;
