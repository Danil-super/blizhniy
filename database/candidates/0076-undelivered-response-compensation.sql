-- Compensation for a captured TEST response whose admitted delivery is terminally blocked.
begin;
set local lock_timeout='3s';
set local statement_timeout='10s';

alter table app.application_compensation_cases
 drop constraint application_compensation_cases_policy_version_check,
 drop constraint application_compensation_cases_reason_check,
 alter column delivered_at drop not null,
 add constraint application_compensation_cases_policy_check check(
  (policy_version='paid-response-unread-v1' and reason in ('unread-five-days','other-selected-unread','customer-closed-unread')
   and delivered_at is not null) or
  (policy_version='paid-response-undelivered-v1' and reason='delivery-blocked'
   and delivered_at is null and contact_view_at is null and selected_application_id is null));

create function app.response_delivery_blocked(purchase app.payment_checkout_intents) returns boolean
 language sql stable set search_path='' as $$
 select exists(
  select 1 from app_response.admissions admission
  join app.payment_reconciliation_jobs q on q.intent_id=admission.intent_id
  join app.applications a on a.id=purchase.target_id and a.applicant_id=purchase.owner_id
  join app.work_publications w on w.id=a.work_publication_id and w.author_id<>a.applicant_id
  where purchase.is_test and purchase.target_type='application' and purchase.tariff_id='job-response'
   and purchase.duration_days is null and admission.intent_id=purchase.id and admission.applicant_id=purchase.owner_id
   and admission.shop_id=purchase.merchant_shop_id
   and q.state='blocked' and q.last_code='publication_blocked' and q.attempts>0
   and a.status='pending_payment' and not a.is_paid and a.sent_at is null
   and not exists(select 1 from app_response.deliveries d where d.intent_id=purchase.id or d.application_id=a.id)
   and not exists(select 1 from app.application_contact_views v where v.application_id=a.id)
   and not exists(select 1 from app.application_selection_events e where e.application_id=a.id));
$$;

create function app.lock_undelivered_response_source(payment_id uuid,shop text) returns jsonb
 language plpgsql set search_path='' as $$
declare purchase app.payment_checkout_intents; target uuid; kind text; captured text; observed timestamptz;
begin
 if pg_catalog.current_setting('transaction_isolation')<>'read committed' then
  raise exception 'Compensation requires read committed' using errcode='23514';end if;
 perform id from app.users where id=(select owner_id from app.payment_checkout_intents where id=payment_id) for update nowait;
 select * into purchase from app.payment_checkout_intents where id=payment_id for update nowait;
 if not found or purchase.merchant_shop_id is distinct from shop or not purchase.is_test or purchase.target_type<>'application' then
  raise exception 'Captured TEST response unavailable' using errcode='PBC01';end if;
 -- Delivery and reconciliation serialize on the intent and the queue row.
 perform intent_id from app.payment_reconciliation_jobs where intent_id=purchase.id for update nowait;
 perform id from app.payment_orders where id=purchase.id and status='succeeded'
  and row(owner_id,target_type,target_id,target_revision)=row(purchase.owner_id,purchase.target_type,purchase.target_id,purchase.target_revision)
  for update nowait;
 if not found or purchase.request_sha256 is distinct from pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(purchase.request_body,'UTF8')),'hex') then
  raise exception 'Captured TEST response unavailable' using errcode='PBC01';end if;
 select v.captured_at into captured from app.payment_verifications v join app.payment_provider_links l
  on l.intent_id=v.intent_id and l.provider_payment_id=v.provider_payment_id where v.intent_id=purchase.id and v.status='succeeded';
 if captured is null or captured::timestamptz>pg_catalog.clock_timestamp()+interval '5 minutes' then
  raise exception 'Original capture required' using errcode='PBC01';end if;
 select work_publication_id into target from app.applications where id=purchase.target_id;
 select w.kind into kind from app.work_publications w where w.id=target for update nowait;
 perform id from app.applications where id=purchase.target_id and work_publication_id=target for update nowait;
 if not found or kind is null or not app.response_delivery_blocked(purchase) then
  raise exception 'Terminal delivery failure required' using errcode='PBC01';end if;
 observed:=pg_catalog.clock_timestamp();
 return pg_catalog.jsonb_build_object('amount',purchase.amount::text,'fiscalMode',app.placement_refund_fiscal_mode(purchase),
  'observedAt',pg_catalog.to_char(observed at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  'facts',pg_catalog.jsonb_build_object('applicationId',purchase.target_id,'kind',kind,'paid',false,'status','pending_payment',
   'sentAt',null,'contactViews','[]'::jsonb,'selected',null,'customerClosedAt',null,'deliveryBlocked',true));
end $$;

create or replace function app.lock_application_compensation_source(payment_id uuid,shop text) returns jsonb
 language plpgsql security definer set search_path='' as $$
declare source jsonb;closed timestamptz;
begin
 if exists(select 1 from app.payment_checkout_intents i join app.applications a on a.id=i.target_id
  join app.payment_reconciliation_jobs q on q.intent_id=i.id
  where i.id=payment_id and i.target_type='application' and a.status='pending_payment'
   and q.state='blocked' and q.last_code='publication_blocked') then
  return app.lock_undelivered_response_source(payment_id,shop);
 end if;
 source:=app.lock_application_compensation_source_v43(payment_id,shop);
 if source->'facts'->>'kind'='workRequest' then
  select min(e.occurred_at) into closed from app.work_owner_actions e
   join app.work_publications w on w.id=e.publication_id and w.author_id=e.owner_id
   join app.applications a on a.work_publication_id=w.id and a.id=(source->'facts'->>'applicationId')::uuid
   where e.kind='workRequest' and e.action in ('withdraw','remove') and e.occurred_at>=a.sent_at;
  if closed is not null then source:=pg_catalog.jsonb_set(source,'{facts,customerClosedAt}',pg_catalog.to_jsonb(pg_catalog.to_char(closed at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')));end if;
 end if;
 return source;
end $$;

create or replace function app.guard_application_compensation_case() returns trigger
 language plpgsql security definer set search_path='' as $$
declare source jsonb;facts jsonb;eligible timestamptz;observed timestamptz;viewed timestamptz;selected timestamptz;selected_id uuid;closed timestamptz;reason text;
begin
 if tg_op<>'INSERT' then raise exception 'Compensation case is immutable' using errcode='42501';end if;
 source:=app.lock_application_compensation_source(new.payment_intent_id,new.merchant_shop_id);facts:=source->'facts';
 observed:=(source->>'observedAt')::timestamptz;
 if facts->'deliveryBlocked'='true'::jsonb then
  new.application_id:=(facts->>'applicationId')::uuid;new.policy_version:='paid-response-undelivered-v1';
  new.amount:=(source->>'amount')::numeric;new.fiscal_mode:=source->>'fiscalMode';new.reason:='delivery-blocked';
  new.eligible_at:=observed;new.delivered_at:=null;new.contact_view_at:=null;new.selected_application_id:=null;
  new.created_at:=observed;return new;
 end if;
 eligible:=(facts->>'sentAt')::timestamptz+interval '120 hours';reason:='unread-five-days';
 if exists(select 1 from pg_catalog.jsonb_array_elements(facts->'contactViews') e where e->>'evidence'='legacy_unknown') then
  raise exception 'Unknown disclosure history requires reconciliation' using errcode='PBC01';end if;
 select (e->>'recordedAt')::timestamptz into viewed from pg_catalog.jsonb_array_elements(facts->'contactViews') e where e->>'evidence'='recipient_read';
 if facts->'selected'<>'null'::jsonb then selected:=(facts->'selected'->>'selectedAt')::timestamptz;selected_id:=(facts->'selected'->>'applicationId')::uuid;end if;
 closed:=(facts->>'customerClosedAt')::timestamptz;
 if (facts->>'sentAt')::timestamptz>observed or (viewed is not null and (viewed<(facts->>'sentAt')::timestamptz or viewed>observed)) or
  (selected is not null and (selected<(facts->>'sentAt')::timestamptz or selected>observed)) or
  (closed is not null and (closed<(facts->>'sentAt')::timestamptz or closed>observed or facts->>'kind'<>'workRequest')) or
  ((facts->>'status'='selected') is distinct from coalesce(selected_id=(facts->>'applicationId')::uuid,false)) or
  ((facts->>'status'='viewed' or selected_id=(facts->>'applicationId')::uuid) and viewed is null) or
  (selected_id=(facts->>'applicationId')::uuid and viewed>selected) then
  raise exception 'Contradictory delivery evidence requires reconciliation' using errcode='23514';end if;
 if selected_id is distinct from (facts->>'applicationId')::uuid and selected<eligible then eligible:=selected;reason:='other-selected-unread';end if;
 if closed<eligible then eligible:=closed;reason:='customer-closed-unread';end if;
 if eligible>observed or viewed<=eligible or (selected_id=(facts->>'applicationId')::uuid and selected<=eligible) then
  raise exception 'Unseen response condition is not satisfied' using errcode='PBC01';end if;
 new.application_id:=(facts->>'applicationId')::uuid;new.policy_version:='paid-response-unread-v1';new.amount:=(source->>'amount')::numeric;
 new.fiscal_mode:=source->>'fiscalMode';new.reason:=reason;new.eligible_at:=eligible;new.delivered_at:=(facts->>'sentAt')::timestamptz;
 new.contact_view_at:=viewed;new.selected_application_id:=selected_id;new.created_at:=observed;return new;
end $$;

create or replace function app.refund_target_admitted(payment_id uuid,operation uuid) returns boolean
 language plpgsql security definer set search_path='' as $$
declare purchase app.payment_checkout_intents;decision app.application_compensation_cases;
begin
 select * into purchase from app.payment_checkout_intents where id=payment_id;
 if not found or not purchase.is_test then return false;end if;
 if purchase.target_type in ('listing','vacancy','workRequest') then
  return purchase.duration_days is not null and
   not exists(select 1 from app.payment_renewals r join app.payment_orders o on o.id=r.intent_id and o.status='succeeded' where r.previous_intent_id=purchase.id) and
   not exists(select 1 from app.payment_orders o where o.owner_id=purchase.owner_id and o.target_type=purchase.target_type and o.target_id=purchase.target_id and o.id<>purchase.id and
    (o.status in ('created','pending') or o.status='succeeded' and not exists(select 1 from app.payment_fulfillments f where f.intent_id=o.id)));
 end if;
 if purchase.target_type='ad_marquee' then
  return purchase.duration_days is not null and exists(select 1 from app.service_payment_terms where intent_id=purchase.id);
 end if;
 if purchase.target_type<>'application' or purchase.duration_days is not null or purchase.is_test is distinct from true or operation is distinct from purchase.id then return false;end if;
 select * into decision from app.application_compensation_cases where payment_intent_id=purchase.id;
 if not found then return false;end if;
 return decision.application_id=purchase.target_id and decision.merchant_shop_id=purchase.merchant_shop_id and
  decision.amount=purchase.amount and
  (decision.policy_version='paid-response-unread-v1' or
   (decision.policy_version='paid-response-undelivered-v1' and app.response_delivery_blocked(purchase))) and
  decision.fiscal_mode=app.placement_refund_fiscal_mode(purchase);
end $$;

create or replace function app.record_application_compensation_refund() returns trigger
 language plpgsql security definer set search_path='' as $$
begin
 update app.payment_orders set status='refunded' where id=new.payment_intent_id and status='succeeded';
 -- The inserted effect owns the transition and notification. A replay inserts neither.
 insert into app.notifications(user_id,event_key,category,tone,title,body,action_href)
  select p.owner_id,'application_compensation:'||new.payment_intent_id::text,'payment','success','Компенсация за отклик',
   case c.reason when 'delivery-blocked' then 'Плата за недоставленный отклик возвращена.'
    else 'Плата за непросмотренный отклик возвращена.' end,'/cabinet/otkliki'
   from app.payment_checkout_intents p join app.application_compensation_cases c on c.payment_intent_id=p.id
   where p.id=new.payment_intent_id
  on conflict(user_id,event_key) do nothing;
 return new;
end $$;

-- A compensated draft stays undelivered. Reuse the original order for history, never charge that response again.
create function app.guard_compensated_response_order() returns trigger
 language plpgsql security definer set search_path='' as $$
begin
 if pg_catalog.current_setting('transaction_isolation')<>'read committed' then
  raise exception 'Response checkout requires read committed' using errcode='23514';end if;
 perform id from app.users where id=new.owner_id for update;
 if exists(select 1 from app.application_compensation_cases where application_id=new.target_id and reason='delivery-blocked') then
  raise exception 'Response checkout already compensated' using errcode='23514';end if;
 return new;
end $$;
create trigger compensated_response_order_guard before insert on app.payment_orders
 for each row when(new.target_type='application') execute function app.guard_compensated_response_order();
alter table app.payment_orders enable always trigger compensated_response_order_guard;
revoke all on function app.response_delivery_blocked(app.payment_checkout_intents),
 app.lock_undelivered_response_source(uuid,text),app.guard_compensated_response_order() from public;
commit;
