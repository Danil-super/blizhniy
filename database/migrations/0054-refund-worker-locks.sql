-- Private refund worker: UPDATE(id) permits row locks, never identity changes.
-- Column-specific triggers leave SECURITY DEFINER refund status updates available.
begin;
set local lock_timeout='3s';
set local statement_timeout='10s';
create function app.guard_refund_worker_locks() returns trigger
 language plpgsql security invoker set search_path='' as $$ begin
 if current_user='blizhniy_refund_worker' or session_user='blizhniy_refund_worker' then
  raise exception using errcode='23514',message='Refund worker lock-only relation';
 end if;
 return new;
end $$;
create trigger refund_worker_lock_only before update of id on app.users
 for each row execute function app.guard_refund_worker_locks();
create trigger refund_worker_lock_only before update of id on app.payment_checkout_intents
 for each row execute function app.guard_refund_worker_locks();
create trigger refund_worker_lock_only before update of id on app.payment_orders
 for each row execute function app.guard_refund_worker_locks();
alter table app.users enable always trigger refund_worker_lock_only;
alter table app.payment_checkout_intents enable always trigger refund_worker_lock_only;
alter table app.payment_orders enable always trigger refund_worker_lock_only;
revoke all on function app.guard_refund_worker_locks() from public;
commit;
