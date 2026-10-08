\set ON_ERROR_STOP on
\set apply_fulfillment_migration true
\ir payment-fulfillment.sql
-- Keep the actual historical browser SELECT contract. The new receipt store
-- must remain private even when a browser can read its own financial row.
grant select on public.payments to authenticated;
\ir ../../supabase/migrations/20261008062202_snapshot_yookassa_checkout_intents.sql
