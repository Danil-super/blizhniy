begin;
set local lock_timeout = '3s';
set local statement_timeout = '10s';
lock table app.payment_checkout_intents,app.payment_dispatch_anchors,app.payment_provider_links in access exclusive mode;
do $$ begin
 if exists(select 1 from app.payment_checkout_intents) or exists(select 1 from app.payment_dispatch_anchors) or exists(select 1 from app.payment_provider_links) then
  raise exception 'Refusing to remove nonempty payment intents';
 end if;
end $$;
drop table app.payment_provider_links;
drop table app.payment_dispatch_anchors;
drop table app.payment_checkout_intents;
drop function app.reject_payment_intent_mutation();
drop function app.stamp_payment_dispatch_anchor();
drop function app.hash_payment_intent();
commit;
