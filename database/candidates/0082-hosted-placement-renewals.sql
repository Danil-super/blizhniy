-- Hosted TEST renewals reuse the immutable periods and refund fences from 0056.
begin;
set local lock_timeout='3s';
set local statement_timeout='10s';

create function app.apply_hosted_placement_renewal(purchase_id uuid, previous_id uuid)
 returns table(published_at timestamptz, expires_at timestamptz)
 language plpgsql security definer set search_path=pg_catalog as $$
declare purchase app.payment_checkout_intents;
declare previous app.payment_checkout_intents;
begin
 select * into purchase from app.payment_checkout_intents where id=purchase_id;
 select * into previous from app.payment_checkout_intents where id=previous_id;
 if purchase.id is null or previous.id is null or previous.id=purchase.id or
  purchase.target_type not in ('listing','vacancy','workRequest') or
  row(previous.owner_id,previous.target_type,previous.target_id,previous.merchant_shop_id)
   is distinct from row(purchase.owner_id,purchase.target_type,purchase.target_id,purchase.merchant_shop_id) or
  not (purchase.is_test and previous.is_test) or purchase.merchant_shop_id !~ '^[1-9][0-9]{0,63}$' or
  purchase.request_body::jsonb#>>'{metadata,publicationMode}' is distinct from 'account-test-v1' or
  previous.request_body::jsonb#>>'{metadata,publicationMode}' is distinct from 'account-test-v1' then
  raise exception using errcode='PRN01',message='Hosted TEST renewal identities required';
 end if;
 if app.placement_refund_fiscal_mode(purchase) is distinct from 'provider-automatic-full' or
  app.placement_refund_fiscal_mode(previous) is distinct from 'provider-automatic-full' then
  raise exception using errcode='PRN01',message='Hosted TEST renewal receipts required';
 end if;
 -- The 0056 trigger acquires the payer and target locks and checks provider capture before writing.
 if not app.phone_is_confirmed(purchase.owner_id) then
  raise exception using errcode='P7601',message='Verified phone required';
 end if;
 return query insert into app.payment_renewals as renewal(intent_id,previous_intent_id)
  values(purchase_id,previous_id) returning renewal.published_at,renewal.expires_at;
end $$;
revoke all on function app.apply_hosted_placement_renewal(uuid,uuid) from public;
grant execute on function app.apply_hosted_placement_renewal(uuid,uuid) to blizhniy_payment_reconciler;

commit;
