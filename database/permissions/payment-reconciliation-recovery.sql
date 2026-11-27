-- Grant only to the separate recovery login created by the reviewed operator package.
begin;
grant usage on schema app to blizhniy_reconciliation_operator;
grant execute on function app.recover_payment_reconciliation(text,uuid,uuid,uuid,text,text,boolean)
 to blizhniy_reconciliation_operator;
grant execute on function app.read_payment_reconciliation_recovery_status(text,uuid,text)
 to blizhniy_reconciliation_operator;
commit;
