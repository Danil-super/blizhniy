-- Empty-schema rollback only. Never remove a verified identity or observation.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '10s';
lock table app.payment_refund_observations,app.payment_refund_provider_links in access exclusive mode;
do $$ begin
 if exists(select 1 from app.payment_refund_observations) or exists(select 1 from app.payment_refund_provider_links) then
  raise exception using errcode='23514',message='Refund journal must be retained';
 end if;
end $$;
drop trigger refund_observation_guard on app.payment_refund_observations;
drop trigger refund_observation_truncate_guard on app.payment_refund_observations;
drop trigger refund_provider_link_guard on app.payment_refund_provider_links;
drop trigger refund_provider_link_truncate_guard on app.payment_refund_provider_links;
drop function app.guard_refund_journal();
drop table app.payment_refund_observations;
drop table app.payment_refund_provider_links;
commit;
