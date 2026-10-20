-- Disable API preparation before operator rollback. Never delete orders or intents.
revoke select(id,owner_id,creation_key,target_type,target_id,target_revision,status,created_at),
 insert(id,owner_id,creation_key,target_type,target_id,target_revision)
 on app.payment_orders from blizhniy_runtime;
revoke select(id,owner_id,target_type,target_id,target_revision,tariff_id,amount,duration_days,merchant_shop_id,is_test,request_body,request_sha256),
 insert(id,owner_id,target_type,target_id,target_revision,tariff_id,amount,duration_days,merchant_shop_id,is_test,request_body)
 on app.payment_checkout_intents from blizhniy_runtime;
revoke select(intent_id,published_at,expires_at)
 on app.payment_fulfillments from blizhniy_runtime;
