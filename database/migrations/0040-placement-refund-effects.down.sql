-- Empty-only rollback: a financial effect receipt is permanent history.
begin;
set local lock_timeout='3s';
set local statement_timeout='10s';
lock table app.payment_refund_effects in access exclusive mode;
do $$ begin
 if exists(select 1 from app.payment_refund_effects) then
  raise exception using errcode='23514',message='Refund effect history must be retained';
 end if;
end $$;
drop trigger placement_refund_effect_guard on app.payment_refund_effects;
drop trigger placement_refund_effect_truncate_guard on app.payment_refund_effects;
drop function app.apply_placement_refund_effect();
drop table app.payment_refund_effects;
commit;
