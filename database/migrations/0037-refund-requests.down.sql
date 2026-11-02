-- Empty-schema rollback only. Never discard a request or an uncertain send window.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '10s';
lock table app.payment_refund_dispatch_anchors,app.payment_refund_requests in access exclusive mode;
do $$ begin
 if exists(select 1 from app.payment_refund_requests) or exists(select 1 from app.payment_refund_dispatch_anchors) then
  raise exception using errcode='23514',message='Refund request history must be retained';
 end if;
end $$;
drop trigger refund_request_guard on app.payment_refund_requests;
drop trigger refund_request_truncate_guard on app.payment_refund_requests;
drop trigger refund_dispatch_guard on app.payment_refund_dispatch_anchors;
drop trigger refund_dispatch_truncate_guard on app.payment_refund_dispatch_anchors;
drop function app.guard_refund_request_history();
drop table app.payment_refund_dispatch_anchors;
drop table app.payment_refund_requests;
commit;
