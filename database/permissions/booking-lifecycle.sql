-- Deliberately not installed by production bootstrap. Local fixture opt-in only.
begin;
grant select(host_id,starts_at,expires_at,cancelled_by,cancellation_reason) on app.booking_requests to blizhniy_runtime;
grant update(cancelled_by,cancellation_reason) on app.booking_requests to blizhniy_runtime;
grant select on app.booking_events to blizhniy_runtime;
grant execute on function app.booking_start_time(text,date,jsonb) to blizhniy_runtime;
-- Event/notification inserts for expiry and cancellation belong only to triggers.
commit;
