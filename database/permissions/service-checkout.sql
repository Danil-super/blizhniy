-- Proposed local operator plan only. No startup, publication or real provider authority.
grant select(intent_id,fair_date,fair_ends_at),insert(intent_id) on app.service_payment_terms to blizhniy_runtime;
grant execute on function app.fair_event_at(timestamptz) to blizhniy_runtime;
