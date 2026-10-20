-- Disable account TEST dispatch first. Keep every immutable order/anchor/provider link.
revoke update(id) on app.payment_checkout_intents from blizhniy_runtime;
revoke select(intent_id,authorized_at),insert(intent_id)
 on app.payment_dispatch_anchors from blizhniy_runtime;
revoke select(intent_id,provider_payment_id),insert(intent_id,provider_payment_id)
 on app.payment_provider_links from blizhniy_runtime;
