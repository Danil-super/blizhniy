begin;
grant execute on function app_payment_admin.list_orders_with_refund_actions(text,uuid,text,text,text,timestamptz,uuid) to blizhniy_runtime;
commit;
