-- The monitor login can observe the presence of blocked TEST jobs.
begin;
grant usage on schema app to blizhniy_reconciliation_monitor;
grant execute on function app.payment_reconciliation_alert_needed(text) to blizhniy_reconciliation_monitor;
commit;
