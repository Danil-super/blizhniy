-- Keep the exact verified recovery path and admit only the paid advertising line.
begin;
set local lock_timeout='3s';
set local statement_timeout='10s';

create or replace function app.lock_refund_recovery_source(operation uuid,candidate uuid) returns jsonb
 language plpgsql security definer set search_path='' as $$
declare reservation app.payment_refund_reservations;purchase app.payment_checkout_intents;prepared app.payment_refund_requests;mode text;
begin
 if pg_catalog.current_setting('transaction_isolation')<>'read committed' or operation is null or candidate is null then
  raise exception 'Invalid refund recovery source' using errcode='23514';end if;
 select * into reservation from app.payment_refund_reservations where id=operation;
 if not found then raise exception 'Refund reservation unavailable' using errcode='23514';end if;
 -- The caller has locked its administrator. Never wait on another user's auth lock.
 perform id from app.users where id=(select owner_id from app.payment_checkout_intents where id=reservation.payment_intent_id) for update nowait;
 if not found then raise exception 'Refund payer unavailable' using errcode='23514';end if;
 select * into purchase from app.payment_checkout_intents where id=reservation.payment_intent_id for update;
 perform id from app.payment_orders where id=purchase.id and status in ('succeeded','refunded') for update;
 if not found then raise exception 'Captured refund purchase required' using errcode='23514';end if;
 select q.* into prepared from app.payment_refund_requests q join app.payment_refund_dispatch_anchors a on a.operation_id=q.operation_id where q.operation_id=operation;
 if not found or purchase.is_test is distinct from true or reservation.is_test is distinct from true or
  reservation.merchant_shop_id is distinct from purchase.merchant_shop_id or reservation.amount is distinct from purchase.amount or
  purchase.request_sha256 is distinct from pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(purchase.request_body,'UTF8')),'hex') or
  prepared.request_sha256 is distinct from pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(prepared.request_body,'UTF8')),'hex') or
  prepared.idempotence_key is distinct from 'refund-'||operation::text or prepared.request_body is distinct from
   pg_catalog.format('{"payment_id":"%s","amount":{"value":"%s","currency":"RUB"},"metadata":{"localRefundId":"%s","localPaymentId":"%s"}}',
    reservation.provider_payment_id,reservation.amount::text,operation,reservation.payment_intent_id) or
  not exists(select 1 from app.payment_refund_send_attempts where operation_id=operation and request_sha256=prepared.request_sha256) or
  not exists(select 1 from app.payment_provider_links l join app.payment_verifications v on v.intent_id=l.intent_id and v.provider_payment_id=l.provider_payment_id
   where l.intent_id=purchase.id and l.provider_payment_id=reservation.provider_payment_id and v.status='succeeded' and v.captured_at is not null) or
  exists(select 1 from app.payment_refund_candidates where operation_id=operation and provider_refund_id<>candidate) or
  exists(select 1 from app.payment_refund_provider_links where operation_id=operation and provider_refund_id<>candidate) then
  raise exception 'Original attempted TEST refund required' using errcode='23514';end if;
 mode:=app.placement_refund_fiscal_mode(purchase);
 if purchase.target_type='application' then
  if app.refund_target_admitted(purchase.id,operation) is distinct from true then raise exception 'Compensation case required' using errcode='23514';end if;
 elsif purchase.duration_days is not null and (
  purchase.target_type in ('listing','vacancy','workRequest') or
  purchase.target_type='ad_marquee' and app.refund_target_admitted(purchase.id,operation)
 ) then
  if not exists(select 1 from app.payment_refund_approvals where id=operation and payment_intent_id=purchase.id and amount=purchase.amount
   and fiscal_mode=mode and policy_version='placement-full-admin-v1') then raise exception 'Original refund approval required' using errcode='23514';end if;
 else raise exception 'Unsupported refund recovery target' using errcode='23514';end if;
 return pg_catalog.jsonb_build_object('paymentIntentId',purchase.id,'targetType',purchase.target_type,'shopId',purchase.merchant_shop_id);
end $$;

commit;
