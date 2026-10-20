-- Explicit operator plan only; never imported or applied by application startup.
-- Owner-approved TEST preparation: no dispatch, settlement or publication authority.
grant select(id,owner_id,creation_key,target_type,target_id,target_revision,status,created_at),
 insert(id,owner_id,creation_key,target_type,target_id,target_revision)
 on app.payment_orders to blizhniy_runtime;
grant select(id,owner_id,target_type,target_id,target_revision,tariff_id,amount,duration_days,merchant_shop_id,is_test,request_body,request_sha256),
 insert(id,owner_id,target_type,target_id,target_revision,tariff_id,amount,duration_days,merchant_shop_id,is_test,request_body)
 on app.payment_checkout_intents to blizhniy_runtime;
grant select(intent_id,published_at,expires_at)
 on app.payment_fulfillments to blizhniy_runtime;
