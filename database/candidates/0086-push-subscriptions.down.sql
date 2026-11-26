begin;
set local lock_timeout='3s';
set local statement_timeout='10s';

lock table app_push.subscriptions in access exclusive mode;
do $$
begin
 if exists(select 1 from app_push.subscriptions) then
  raise exception 'Push subscriptions are not empty';
 end if;
end $$;
drop function app_push.may_display(text,uuid);
drop function app_push.set_subscription(text,uuid,text,text,text,timestamptz);
drop function app_push.subscription_state(text,uuid);
drop function app_push.preference_enabled(uuid);
drop function app_push.current_owner(text);
drop table app_push.subscriptions;
drop schema app_push;
commit;
