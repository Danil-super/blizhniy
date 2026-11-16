-- Explicit operator rollback; the shared Telegram and checkout grants are preserved.
revoke select(intent_id,fair_date,fair_ends_at),insert(intent_id) on app.service_payment_terms from blizhniy_runtime;
revoke execute on function app.fair_event_at(timestamptz) from blizhniy_runtime;
