begin;
set local lock_timeout='3s';
set local statement_timeout='10s';

lock table app.notifications in access exclusive mode;
lock table app_push.deliveries in access exclusive mode;
do $$
begin
 if exists(select 1 from app_push.deliveries) then raise exception 'Push delivery journal is not empty';end if;
end $$;

create or replace function app_push.may_display(session_key text,subscription_id uuid) returns boolean
language sql stable security definer set search_path=pg_catalog,pg_temp as $$
 select app_push.preference_enabled(app_push.current_owner(session_key)) and exists(
  select 1 from app_push.subscriptions where session_hash=session_key and id=subscription_id
   and (expires_at is null or expires_at>statement_timestamp())
 );
$$;

drop trigger enqueue_push_delivery on app.notifications;
drop function app_push.enqueue_delivery();
drop function app_push.claim_delivery(uuid);
drop function app_push.finish_delivery(uuid,uuid,text,integer);
drop function app_push.sweep_delivery();
drop function app_push.delivery_allowed(uuid,uuid);
drop table app_push.deliveries;
commit;
