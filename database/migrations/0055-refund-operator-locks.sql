-- Private operator row-lock capability never permits identity writes.
begin;
set local lock_timeout='3s';
set local statement_timeout='10s';
create function app.guard_refund_operator_locks() returns trigger
 language plpgsql security invoker set search_path='' as $$ begin
 if current_user='blizhniy_refund_operator' or session_user='blizhniy_refund_operator' then
  raise exception using errcode='23514',message='Refund operator lock-only relation';
 end if;
 return new;
end $$;
create trigger refund_operator_lock_only before update of id on app.users
 for each row execute function app.guard_refund_operator_locks();
create trigger refund_operator_lock_only before update of id on app.payment_checkout_intents
 for each row execute function app.guard_refund_operator_locks();
create trigger refund_operator_lock_only before update of id on app.payment_orders
 for each row execute function app.guard_refund_operator_locks();
alter table app.users enable always trigger refund_operator_lock_only;
alter table app.payment_checkout_intents enable always trigger refund_operator_lock_only;
alter table app.payment_orders enable always trigger refund_operator_lock_only;
revoke all on function app.guard_refund_operator_locks() from public;
commit;
