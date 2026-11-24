-- Fixed read-only probe for the TEST reconciliation monitor. No data or grants.
begin;
set local lock_timeout='3s';
set local statement_timeout='10s';

create function app.payment_reconciliation_alert_needed(p_shop text) returns boolean
 language plpgsql stable security definer set search_path='' as $$
begin
 if p_shop is null or p_shop !~ '^[a-zA-Z0-9_-]{1,64}$' then
  raise exception 'Invalid reconciliation shop' using errcode='22023';
 end if;
 return exists(select 1 from app.payment_reconciliation_jobs q
  join app.payment_checkout_intents i on i.id=q.intent_id
  where q.state='blocked' and i.is_test and i.merchant_shop_id=p_shop);
end $$;
revoke all on function app.payment_reconciliation_alert_needed(text) from public;
commit;
