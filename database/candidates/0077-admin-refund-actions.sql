-- The journal projects available commands without awarding financial rights.
begin;
set local lock_timeout='3s';
set local statement_timeout='10s';

create function app_payment_admin.refund_action(item jsonb,p_shop text)
 returns jsonb language plpgsql stable set search_path='' as $$
declare kind text:=item->>'targetType';stage text:=item->>'refund';
 payment_id uuid:=(item->>'id')::uuid;operation_id uuid;provider_id uuid;
begin
 if item->>'orderStatus'<>'succeeded' or item->>'providerStatus'<>'succeeded'
  or item->>'capturedAt' is null or kind not in ('listing','vacancy','workRequest','ad_marquee','specialist','application') then return null;end if;
 if kind='ad_marquee' and not exists(select 1 from blizhniy_meta.migrations
  where name='0078-hosted-marquee-refund-recovery.sql') then return null;end if;
 if kind='specialist' and not exists(select 1 from blizhniy_meta.migrations
  where name='0080-hosted-specialist-refunds.sql') then return null;end if;
 if stage='none' and kind<>'application' and app.refund_target_admitted(payment_id,payment_id) then
  begin
   perform app.placement_refund_fiscal_mode(p) from app.payment_checkout_intents p where p.id=payment_id;
  exception when check_violation then return null;
  end;
  return pg_catalog.jsonb_build_object('kind','approve');
 end if;
 if stage not in ('unknown','awaiting_verification','pending','succeeded') then return null;end if;
 select b.id,coalesce(l.provider_refund_id,c.provider_refund_id) into operation_id,provider_id
 from app.payment_refund_reservations b
 left join app.payment_refund_approvals a on a.id=b.id and a.payment_intent_id=b.payment_intent_id
 left join app.payment_refund_provider_links l on l.operation_id=b.id
 left join app.payment_refund_candidates c on c.operation_id=b.id
 where b.payment_intent_id=payment_id and b.merchant_shop_id=p_shop and b.is_test
  and ((kind='application' and b.id=payment_id) or (kind<>'application' and a.id=b.id))
  and exists(select 1 from app.payment_refund_send_attempts s where s.operation_id=b.id);
 if not found then return null;end if;
 return pg_catalog.jsonb_build_object('kind','recover','operationId',operation_id,'providerRefundId',provider_id);
end $$;

create function app_payment_admin.list_orders_with_refund_actions(
 p_session text,p_admin uuid,p_shop text,p_kind text,p_status text,p_before timestamptz,p_before_id uuid
) returns setof jsonb language sql stable security definer set search_path='' as $$
 select entry.item || pg_catalog.jsonb_build_object('refundAction',app_payment_admin.refund_action(entry.item,p_shop))
 from app_payment_admin.list_orders(p_session,p_admin,p_shop,p_kind,p_status,p_before,p_before_id)
 with ordinality as entry(item,position)
 order by position;
$$;
revoke all on function app_payment_admin.refund_action(jsonb,text),
 app_payment_admin.list_orders_with_refund_actions(text,uuid,text,text,text,timestamptz,uuid) from public;
commit;
