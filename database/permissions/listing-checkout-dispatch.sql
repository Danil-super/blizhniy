-- Explicit approved operator plan. TEST dispatch only, never startup/autodeploy DDL.
-- UPDATE(id) permits row locks; the existing immutable trigger forbids every actual UPDATE.
-- Operator must verify the canonical active guard and absence of replication/trigger override.
grant update(id) on app.payment_checkout_intents to blizhniy_runtime;
grant select(intent_id,authorized_at),insert(intent_id)
 on app.payment_dispatch_anchors to blizhniy_runtime;
grant select(intent_id,provider_payment_id),insert(intent_id,provider_payment_id)
 on app.payment_provider_links to blizhniy_runtime;
