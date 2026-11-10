-- Private TEST intake only. Keep the original source validator and immutable existing cases.
begin;
set local lock_timeout='3s';set local statement_timeout='10s';
alter function app.lock_application_compensation_source(uuid,text) rename to lock_application_compensation_source_v43;
create function app.lock_application_compensation_source(payment_id uuid,shop text) returns jsonb
 language plpgsql security definer set search_path='' as $$
declare source jsonb;closed timestamptz;
begin
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
alter table app.application_compensation_cases drop constraint application_compensation_cases_reason_check;
alter table app.application_compensation_cases add constraint application_compensation_cases_reason_check
 check(reason in ('unread-five-days','other-selected-unread','customer-closed-unread'));
create or replace function app.guard_application_compensation_case() returns trigger
 language plpgsql security definer set search_path='' as $$
declare source jsonb;facts jsonb;eligible timestamptz;observed timestamptz;viewed timestamptz;selected timestamptz;selected_id uuid;closed timestamptz;reason text;
begin
 if tg_op<>'INSERT' then raise exception 'Compensation case is immutable' using errcode='42501';end if;
 source:=app.lock_application_compensation_source(new.payment_intent_id,new.merchant_shop_id);facts:=source->'facts';
 observed:=(source->>'observedAt')::timestamptz;eligible:=(facts->>'sentAt')::timestamptz+interval '120 hours';reason:='unread-five-days';
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
revoke all on function app.lock_application_compensation_source(uuid,text),app.lock_application_compensation_source_v43(uuid,text),app.guard_application_compensation_case() from public;
commit;
