-- Empty-only rollback. Never erase an uncertain send or a known candidate.
begin;
set local lock_timeout='3s';
set local statement_timeout='10s';
lock table app.payment_refund_candidates,app.payment_refund_send_attempts,app.payment_refund_provider_links in access exclusive mode;
do $$ begin
 if exists(select 1 from app.payment_refund_candidates) or exists(select 1 from app.payment_refund_send_attempts) then
  raise exception using errcode='23514',message='Refund send history must be retained';
 end if;
end $$;
drop trigger zz_refund_dispatch_identity_guard on app.payment_refund_provider_links;
drop trigger zz_refund_dispatch_identity_guard on app.payment_refund_candidates;
drop function app.guard_refund_dispatch_identity();
drop trigger refund_send_attempt_guard on app.payment_refund_send_attempts;
drop trigger refund_send_attempt_truncate_guard on app.payment_refund_send_attempts;
drop trigger refund_send_candidate_guard on app.payment_refund_candidates;
drop trigger refund_send_candidate_truncate_guard on app.payment_refund_candidates;
drop function app.guard_refund_dispatch();
drop table app.payment_refund_candidates;
drop table app.payment_refund_send_attempts;
commit;
