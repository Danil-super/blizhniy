-- Read only the oldest eligible hosted advertisement when a slot can be attempted.
begin;
set local lock_timeout='3s';
set local statement_timeout='10s';

create function app.next_hosted_marquee(shop text) returns uuid
 language plpgsql volatile security definer set search_path=pg_catalog as $$
declare next_id uuid; next_shop text;
begin
 if shop is null or shop !~ '^[1-9][0-9]{0,63}$' then
  raise exception using errcode='PSM01',message='Marquee TEST shop required';
 end if;
 if (select count(*) from app.service_publications slot
  where slot.kind='marquee' and slot.status='published' and slot.is_paid and slot.deleted_at is null
   and slot.published_at<=clock_timestamp() and slot.expires_at>clock_timestamp())>=5 then return null;end if;
 select i.id,i.merchant_shop_id into next_id,next_shop
 from app.marquee_test_admissions a join app.payment_checkout_intents i on i.id=a.intent_id
 join app.payment_verifications v on v.intent_id=i.id and v.status='succeeded'
 where i.target_type='ad_marquee' and i.is_test and app.service_payment_eligible(i.id)
 order by (left(v.captured_at,19)||'.'||rpad(coalesce(substring(v.captured_at from '[.]([0-9]+)Z$'),''),9,'0')||'Z') collate "C",i.id
 limit 1;
 -- The existing fulfillment trigger serializes capacity and rechecks this order.
 if next_shop=shop then return next_id;end if;
 return null;
end $$;
revoke all on function app.next_hosted_marquee(text) from public;
grant execute on function app.next_hosted_marquee(text) to blizhniy_payment_reconciler;

commit;
