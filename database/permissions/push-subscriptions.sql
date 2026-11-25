begin;
grant usage on schema app_push to blizhniy_runtime;
grant execute on function app_push.subscription_state(text,uuid),
 app_push.set_subscription(text,uuid,text,text,text,timestamptz),app_push.may_display(text,uuid) to blizhniy_runtime;
commit;
