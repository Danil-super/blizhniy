-- Dedicated aggregate monitor. This package changes only the operations_health schema.
begin;
set local lock_timeout='3s';
set local statement_timeout='10s';
set local search_path=pg_catalog;

do $$
begin
 if to_regclass('app.mail_outbox') is null or to_regclass('notification_delivery.business_email') is null
  or to_regclass('app_push.deliveries') is null or to_regclass('app.payment_reconciliation_jobs') is null
  or to_regprocedure('app.payment_reconciliation_alert_needed(text)') is null then
  raise exception 'Notification and TEST reconciliation queues are required';
 end if;
end $$;

create schema operations_health;
revoke all on schema operations_health from public;

create function operations_health.queue_backlog(p_shop text)
returns table(auth_mail boolean,business_email boolean,push boolean,payment_test boolean)
language plpgsql stable security definer set search_path='' as $$
begin
 if p_shop is null or p_shop !~ '^[a-zA-Z0-9_-]{1,64}$' then
  raise exception 'Invalid reconciliation shop' using errcode='22023';
 end if;
 return query select
  exists(select 1 from app.mail_outbox q where
   (q.state='ready' and q.available_at<=statement_timestamp()-interval '2 minutes') or
   (q.state in ('reserved','sending') and q.lease_until<=statement_timestamp()-interval '1 minute')),
  exists(select 1 from notification_delivery.business_email q where
   (q.state='ready' and q.available_at<=statement_timestamp()-interval '5 minutes') or
   (q.state='sending' and q.lease_until<=statement_timestamp()-interval '1 minute')),
  exists(select 1 from app_push.deliveries q where
   (q.state='ready' and q.available_at<=statement_timestamp()-interval '2 minutes') or
   (q.state='sending' and q.lease_until<=statement_timestamp()-interval '1 minute')),
  app.payment_reconciliation_alert_needed(p_shop) or
  exists(select 1 from app.payment_reconciliation_jobs q
   join app.payment_checkout_intents i on i.id=q.intent_id
   where i.is_test and i.merchant_shop_id=p_shop and
    ((q.state='queued' and q.next_attempt_at<=statement_timestamp()-interval '5 minutes') or
     (q.state='processing' and q.lease_until<=statement_timestamp()-interval '1 minute')));
end $$;

revoke all on function operations_health.queue_backlog(text) from public;
commit;
