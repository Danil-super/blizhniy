-- Explicit TEST rollout only. No general payment status or financial history mutation authority.
begin;
grant select on app.payment_checkout_cancellations to blizhniy_runtime;
grant insert(payment_id) on app.payment_checkout_cancellations to blizhniy_runtime;
commit;
