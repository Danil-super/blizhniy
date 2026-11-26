-- The web login can call the administrator-checked projection.
begin;
grant usage on schema app_payment_admin to blizhniy_runtime;
grant execute on function app_payment_admin.list_orders(text,uuid,text,text,text,timestamptz,uuid) to blizhniy_runtime;
commit;
