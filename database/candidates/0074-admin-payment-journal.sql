-- Separate read model. The web role receives no table rights or financial command.
begin;
set local lock_timeout='3s';
set local statement_timeout='10s';
create schema app_payment_admin;
revoke all on schema app_payment_admin from public;

create function app_payment_admin.outcomes(p_intent uuid,p_shop text,p_kind text)
 returns jsonb language plpgsql stable set search_path='' as $$
declare
 fulfillment text:='not_recorded'; fulfilled_at timestamptz;
 refund text:='unavailable'; refunded_at timestamptz; operation uuid; observed text;
 compensation text:='unavailable'; compensation_state text; compensated_at timestamptz;
begin
 if p_kind='application' then
  if pg_catalog.to_regclass('app_response.deliveries') is null then
   fulfillment:='unavailable';
  else
   select sent_at into fulfilled_at from app_response.deliveries where intent_id=p_intent;
   if found then fulfillment:='delivered';end if;
  end if;
 else
  select f.fulfilled_at into fulfilled_at from app.payment_fulfillments f where f.intent_id=p_intent;
  if found then fulfillment:='fulfilled';end if;
 end if;

 if pg_catalog.to_regclass('app.payment_refund_approvals') is not null then
  if exists(select 1 from app.payment_refund_approvals where payment_intent_id=p_intent) then refund:='approved';end if;
 end if;
 if pg_catalog.to_regclass('app.payment_refund_reservations') is not null then
  if refund='unavailable' then refund:='none';end if;
  select id into operation from app.payment_refund_reservations
   where payment_intent_id=p_intent and merchant_shop_id=p_shop and is_test;
  if found then
   refund:='reserved';
   if pg_catalog.to_regclass('app.payment_refund_requests') is not null then
    if exists(select 1 from app.payment_refund_requests where operation_id=operation) then refund:='prepared';end if;
   end if;
   if pg_catalog.to_regclass('app.payment_refund_send_attempts') is not null then
    if exists(select 1 from app.payment_refund_send_attempts where operation_id=operation) then refund:='unknown';end if;
   end if;
   if pg_catalog.to_regclass('app.payment_refund_provider_links') is not null then
    if exists(select 1 from app.payment_refund_provider_links where operation_id=operation) then refund:='awaiting_verification';end if;
   end if;
   if pg_catalog.to_regclass('app.payment_refund_observations') is not null then
    select status into observed from app.payment_refund_observations where operation_id=operation
     order by (status in ('succeeded','canceled')) desc,observed_at desc limit 1;
    if found then refund:=observed;end if;
   end if;
   if pg_catalog.to_regclass('app.payment_refund_effects') is not null then
    select applied_at into refunded_at from app.payment_refund_effects
     where operation_id=operation and payment_intent_id=p_intent and merchant_shop_id=p_shop;
    if found then refund:='applied';end if;
   end if;
  end if;
 end if;

 if p_kind='application' then
  if pg_catalog.to_regclass('app.application_compensation_cases') is not null then
   compensation:='none';
   if exists(select 1 from app.application_compensation_cases where payment_intent_id=p_intent and merchant_shop_id=p_shop) then
    compensation:='eligible';
   end if;
  end if;
  if pg_catalog.to_regclass('app.application_compensation_jobs') is not null then
   select state into compensation_state from app.application_compensation_jobs where payment_intent_id=p_intent and merchant_shop_id=p_shop;
   if found then compensation:=compensation_state;end if;
  end if;
  if pg_catalog.to_regclass('app.application_compensation_refunds') is not null then
   select applied_at into compensated_at from app.application_compensation_refunds
    where payment_intent_id=p_intent and merchant_shop_id=p_shop;
   if found then compensation:='applied';refund:='applied';refunded_at:=compensated_at;end if;
  end if;
 else compensation:='not_applicable';
 end if;
 return pg_catalog.jsonb_build_object('fulfillment',fulfillment,'fulfilledAt',
  pg_catalog.to_char(fulfilled_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  'refund',refund,'refundedAt',pg_catalog.to_char(refunded_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  'compensation',compensation);
end $$;

create function app_payment_admin.list_orders(
 p_session text,p_admin uuid,p_shop text,p_kind text,p_status text,p_before timestamptz,p_before_id uuid
) returns setof jsonb language plpgsql stable security definer set search_path='' as $$
begin
 -- A direct invoker cannot hold a snapshot from before an administrator's revocation.
 if pg_catalog.current_setting('transaction_isolation')<>'read committed' or p_session is null or p_session !~ '^[a-f0-9]{64}$' then
  raise exception 'Administrator access required' using errcode='42501';end if;
 if not exists(select 1 from app.users u join app.sessions s on s.user_id=u.id and s.auth_version=u.auth_version
  where u.id=p_admin and u.role='admin' and not u.is_blocked and u.email_verified_at is not null
   and s.token_hash=p_session and s.scope='app'
   and s.expires_at>pg_catalog.statement_timestamp() and s.last_seen_at>pg_catalog.statement_timestamp()-interval '30 minutes') then
  raise exception 'Administrator access required' using errcode='42501';end if;

 if p_shop is null or p_shop !~ '^[a-zA-Z0-9_-]{1,64}$'
  or (p_kind is not null and p_kind not in ('listing','vacancy','workRequest','specialist','application','fair_application','ad_marquee'))
  or (p_status is not null and p_status not in ('created','pending','succeeded','failed','refunded'))
  or ((p_before is null)<>(p_before_id is null)) or (p_before is not null and not pg_catalog.isfinite(p_before)) then
  raise exception 'Invalid payment journal filters' using errcode='22023';end if;

 -- All stages are projected from the calling statement's snapshot.
 return query with page as materialized (
  select i.id,i.target_id,i.target_type,i.amount,i.created_at,o.status
  from app.payment_checkout_intents i join app.payment_orders o on o.id=i.id and o.owner_id=i.owner_id
   and o.target_type=i.target_type and o.target_id=i.target_id and o.target_revision=i.target_revision
  where i.is_test and i.merchant_shop_id=p_shop and (p_kind is null or i.target_type=p_kind)
   and (p_status is null or o.status=p_status) and (p_before is null or (i.created_at,i.id)<(p_before,p_before_id))
  order by i.created_at desc,i.id desc limit 51
 )
 select pg_catalog.jsonb_build_object('id',p.id,'targetId',p.target_id,'targetType',p.target_type,'amount',p.amount::text,
  'createdAt',pg_catalog.to_char(p.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  'orderStatus',p.status,'providerStatus',coalesce(v.status,case when l.intent_id is not null then 'awaiting_verification'
   when a.intent_id is not null then 'unknown' else 'not_sent' end),
  'capturedAt',v.captured_at,'reconciliation',q.state,'reconciliationCode',q.last_code)
  || app_payment_admin.outcomes(p.id,p_shop,p.target_type)
 from page p left join app.payment_dispatch_anchors a on a.intent_id=p.id
 left join app.payment_provider_links l on l.intent_id=p.id
 left join app.payment_verifications v on v.intent_id=p.id and v.provider_payment_id=l.provider_payment_id
 left join app.payment_reconciliation_jobs q on q.intent_id=p.id
 order by p.created_at desc,p.id desc;
end $$;

revoke all on function app_payment_admin.outcomes(uuid,text,text),
 app_payment_admin.list_orders(text,uuid,text,text,text,timestamptz,uuid) from public;
commit;
