-- Private local TEST admission only; no refunds, runtime grants or provider activation.
begin;
set local lock_timeout='3s';
set local statement_timeout='10s';
lock table app.applications,app.application_contact_views in share row exclusive mode;

create table app.application_selection_events (
 application_id uuid primary key references app.applications(id) on delete restrict,
 work_publication_id uuid not null references app.work_publications(id) on delete restrict,
 kind text not null check(kind in ('vacancy','workRequest')),
 recipient_id uuid not null references app.users(id) on delete restrict,
 selected_at timestamptz not null check(isfinite(selected_at))
);
create unique index application_one_order_selection on app.application_selection_events(work_publication_id) where kind='workRequest';
create index application_selection_work_idx on app.application_selection_events(work_publication_id,application_id);
create function app.guard_application_selection_event() returns trigger
 language plpgsql security definer set search_path='' as $$
declare target uuid;item app.applications;work app.work_publications;
begin
 if tg_op<>'INSERT' then raise exception 'Selection evidence is immutable' using errcode='42501';end if;
 select work_publication_id into target from app.applications where id=new.application_id;
 select * into work from app.work_publications where id=target for update nowait;
 select * into item from app.applications where id=new.application_id for update nowait;
 if item.work_publication_id is distinct from work.id or item.status is distinct from 'selected' or not item.is_paid or item.sent_at is null or
  item.applicant_id=work.author_id or item.sent_at>pg_catalog.clock_timestamp() or
  (work.kind='workRequest' and exists(select 1 from app.applications a where a.work_publication_id=work.id and a.id<>item.id and a.status='selected')) then
  raise exception 'Selection requires a delivered response' using errcode='23514';
 end if;
 new.work_publication_id:=work.id;new.kind:=work.kind;new.recipient_id:=work.author_id;new.selected_at:=pg_catalog.clock_timestamp();return new;
end $$;
create trigger application_selection_event_guard before insert or update or delete on app.application_selection_events
 for each row execute function app.guard_application_selection_event();
create trigger application_selection_event_truncate_guard before truncate on app.application_selection_events
 for each statement execute function app.guard_application_selection_event();
create function app.record_application_selection_event() returns trigger
 language plpgsql security definer set search_path='' as $$
begin
 if new.status='selected' and old.status is distinct from new.status then
  insert into app.application_selection_events(application_id) values(new.id) on conflict do nothing;
 end if;
 return new;
end $$;
-- Existing0035 disclosure evidence must be recorded before the selection time.
create trigger zz_application_selection_event after update of status on app.applications
 for each row execute function app.record_application_selection_event();

create or replace function app.guard_application_contact_view() returns trigger
 language plpgsql security definer set search_path='' as $$
declare target uuid;item app.applications;work app.work_publications;
begin
 if tg_op<>'INSERT' then raise exception 'Application contact evidence is immutable' using errcode='23514';end if;
 if pg_catalog.current_setting('transaction_isolation')<>'read committed' then raise exception 'Disclosure requires read committed' using errcode='23514';end if;
 select work_publication_id into target from app.applications where id=new.application_id;
 select * into work from app.work_publications where id=target for update nowait;
 select * into item from app.applications where id=new.application_id for update nowait;
 if new.evidence is distinct from 'recipient_read' or item.work_publication_id is distinct from work.id or work.author_id is distinct from new.recipient_id or
  item.applicant_id=new.recipient_id or not item.is_paid or item.sent_at is null or item.sent_at>pg_catalog.clock_timestamp() or
  item.status not in ('sent','viewed','selected','rejected') then
  raise exception 'Application contact evidence requires an authorized delivery' using errcode='23514';
 end if;
 -- No backdating, including direct INSERTs that waited behind another request.
 new.recorded_at:=pg_catalog.clock_timestamp();return new;
end $$;

create function app.lock_application_compensation_source(payment_id uuid,shop text) returns jsonb
 language plpgsql security definer set search_path='' as $$
declare purchase app.payment_checkout_intents;payment app.payment_orders;item app.applications;work app.work_publications;
 selection app.application_selection_events;views jsonb;captured text;capture_key text;provider uuid;mode text;observed timestamptz;
begin
 if pg_catalog.current_setting('transaction_isolation')<>'read committed' then raise exception 'Compensation requires read committed' using errcode='23514';end if;
 perform id from app.users where id=(select owner_id from app.payment_checkout_intents where id=payment_id) for update nowait;
 select * into purchase from app.payment_checkout_intents where id=payment_id for update nowait;
 select * into payment from app.payment_orders where id=payment_id for update nowait;
 if purchase.id is null or payment.id is null or purchase.target_type is distinct from 'application' or purchase.is_test is distinct from true or
  purchase.merchant_shop_id is distinct from shop or purchase.tariff_id is distinct from 'job-response' or purchase.duration_days is not null or
  payment.status is distinct from 'succeeded' or payment.owner_id is distinct from purchase.owner_id or payment.target_type is distinct from purchase.target_type or
  payment.target_id is distinct from purchase.target_id or payment.target_revision is distinct from purchase.target_revision or
  purchase.request_sha256 is distinct from pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(purchase.request_body,'UTF8')),'hex') then
  raise exception 'Original captured TEST response required' using errcode='23514';
 end if;
 select v.captured_at,v.provider_payment_id into captured,provider from app.payment_verifications v join app.payment_provider_links l
  on l.intent_id=v.intent_id and l.provider_payment_id=v.provider_payment_id where v.intent_id=payment_id and v.status='succeeded';
 if captured is null or provider is null then raise exception 'Original capture required' using errcode='23514';end if;
 capture_key:=pg_catalog.left(captured,19)||'.'||pg_catalog.rpad(coalesce(pg_catalog.substring(captured,'[.]([0-9]+)Z$'),''),9,'0')||'Z';
 if capture_key collate "C" > (pg_catalog.to_char((pg_catalog.clock_timestamp()+interval '5 minutes') at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US')||'000Z') collate "C" then
  raise exception 'Capture chronology requires reconciliation' using errcode='23514';
 end if;
 mode:=app.placement_refund_fiscal_mode(purchase);
 select work_publication_id into item.work_publication_id from app.applications where id=purchase.target_id;
 select * into work from app.work_publications where id=item.work_publication_id for update nowait;
 select * into item from app.applications where id=purchase.target_id for update nowait;
 if item.id is null or work.id is null or item.work_publication_id is distinct from work.id or item.applicant_id is distinct from purchase.owner_id or
  item.applicant_id=work.author_id or not item.is_paid or item.sent_at is null or item.status not in ('sent','viewed','selected','rejected') then
  raise exception 'Captured response delivery required' using errcode='23514';
 end if;
 -- Re-read journals only after the work/application locks, never a pre-wait snapshot.
 select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('evidence',e.evidence,'recordedAt',
  pg_catalog.to_char(e.recorded_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')) order by e.evidence),'[]'::jsonb)
  into views from app.application_contact_views e where e.application_id=item.id and e.recipient_id=work.author_id;
 if exists(select 1 from app.application_contact_views e where e.application_id=item.id and e.recipient_id<>work.author_id) then
  raise exception 'Historical recipient requires reconciliation' using errcode='PBC02';
 end if;
 select * into selection from app.application_selection_events s where s.work_publication_id=work.id and
  (work.kind='workRequest' or s.application_id=item.id);
 if selection.application_id is null then
  if exists(select 1 from app.applications a where a.work_publication_id=work.id and a.status='selected' and
   (work.kind='workRequest' or a.id=item.id)) then raise exception 'Historical selection requires reconciliation' using errcode='PBC02';end if;
 elsif selection.recipient_id<>work.author_id or selection.kind<>work.kind or not exists(select 1 from app.applications a where
  a.id=selection.application_id and a.work_publication_id=work.id and a.status='selected' and a.is_paid and a.sent_at<=selection.selected_at) then
  raise exception 'Selection evidence requires reconciliation' using errcode='PBC02';
 end if;
 observed:=pg_catalog.clock_timestamp();
 return pg_catalog.jsonb_build_object('amount',purchase.amount::text,'fiscalMode',mode,'observedAt',pg_catalog.to_char(observed at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  'facts',pg_catalog.jsonb_build_object('applicationId',item.id,'kind',work.kind,'paid',item.is_paid,'status',item.status,
   'sentAt',pg_catalog.to_char(item.sent_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'contactViews',views,
   'selected',case when selection.application_id is null then null else pg_catalog.jsonb_build_object('applicationId',selection.application_id,
    'selectedAt',pg_catalog.to_char(selection.selected_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')) end,
   'customerClosedAt',null));
end $$;

create table app.application_compensation_cases (
 payment_intent_id uuid primary key references app.payment_orders(id) on delete restrict,
 application_id uuid not null unique references app.applications(id) on delete restrict,
 merchant_shop_id text not null,
 policy_version text not null check(policy_version='paid-response-unread-v1'),
 amount numeric(12,2) not null check(amount>0 and amount<'Infinity'::numeric),
 fiscal_mode text not null check(fiscal_mode in ('provider-automatic-full','test-without-receipt')),
 reason text not null check(reason in ('unread-five-days','other-selected-unread')),
 eligible_at timestamptz not null check(isfinite(eligible_at)),
 delivered_at timestamptz not null check(isfinite(delivered_at)),
 contact_view_at timestamptz check(isfinite(contact_view_at)),
 selected_application_id uuid references app.application_selection_events(application_id) on delete restrict,
 created_at timestamptz not null check(isfinite(created_at) and created_at>=eligible_at)
);
create function app.guard_application_compensation_case() returns trigger
 language plpgsql security definer set search_path='' as $$
declare source jsonb;facts jsonb;eligible timestamptz;observed timestamptz;viewed timestamptz;selected timestamptz;selected_id uuid;reason text;
begin
 if tg_op<>'INSERT' then raise exception 'Compensation case is immutable' using errcode='42501';end if;
 source:=app.lock_application_compensation_source(new.payment_intent_id,new.merchant_shop_id);facts:=source->'facts';
 observed:=(source->>'observedAt')::timestamptz;
 -- Elapsed120 hours is independent of the database session's calendar timezone.
 eligible:=(facts->>'sentAt')::timestamptz+interval '120 hours';reason:='unread-five-days';
 if exists(select 1 from pg_catalog.jsonb_array_elements(facts->'contactViews') e where e->>'evidence'='legacy_unknown') then
  raise exception 'Unknown disclosure history requires reconciliation' using errcode='PBC01';
 end if;
 select (e->>'recordedAt')::timestamptz into viewed from pg_catalog.jsonb_array_elements(facts->'contactViews') e where e->>'evidence'='recipient_read';
 if facts->'selected'<>'null'::jsonb then selected:=(facts->'selected'->>'selectedAt')::timestamptz;selected_id:=(facts->'selected'->>'applicationId')::uuid;end if;
 if (facts->>'sentAt')::timestamptz>observed or (viewed is not null and (viewed<(facts->>'sentAt')::timestamptz or viewed>observed)) or
  (selected is not null and (selected<(facts->>'sentAt')::timestamptz or selected>observed)) or
  ((facts->>'status'='selected') is distinct from coalesce(selected_id=(facts->>'applicationId')::uuid,false)) or
  ((facts->>'status'='viewed' or selected_id=(facts->>'applicationId')::uuid) and viewed is null) or
  (selected_id=(facts->>'applicationId')::uuid and viewed>selected) then
  raise exception 'Contradictory delivery evidence requires reconciliation' using errcode='23514';
 end if;
 if selected_id is distinct from (facts->>'applicationId')::uuid and selected<eligible then eligible:=selected;reason:='other-selected-unread';end if;
 if eligible>observed or viewed<=eligible or (selected_id=(facts->>'applicationId')::uuid and selected<=eligible) then
  raise exception 'Unseen response condition is not satisfied' using errcode='PBC01';
 end if;
 new.application_id:=(facts->>'applicationId')::uuid;new.policy_version:='paid-response-unread-v1';new.amount:=(source->>'amount')::numeric;
 new.fiscal_mode:=source->>'fiscalMode';new.reason:=reason;new.eligible_at:=eligible;new.delivered_at:=(facts->>'sentAt')::timestamptz;
 new.contact_view_at:=viewed;new.selected_application_id:=selected_id;new.created_at:=observed;return new;
end $$;
create trigger application_compensation_case_guard before insert or update or delete on app.application_compensation_cases
 for each row execute function app.guard_application_compensation_case();
create trigger application_compensation_case_truncate_guard before truncate on app.application_compensation_cases
 for each statement execute function app.guard_application_compensation_case();
alter table app.application_selection_events enable always trigger application_selection_event_guard;
alter table app.application_selection_events enable always trigger application_selection_event_truncate_guard;
alter table app.applications enable always trigger zz_application_selection_event;
alter table app.application_contact_views enable always trigger application_contact_view_guard;
alter table app.application_compensation_cases enable always trigger application_compensation_case_guard;
alter table app.application_compensation_cases enable always trigger application_compensation_case_truncate_guard;
revoke all on app.application_selection_events,app.application_compensation_cases from public;
revoke all on function app.guard_application_selection_event(),app.record_application_selection_event(),app.lock_application_compensation_source(uuid,text),app.guard_application_compensation_case(),app.guard_application_contact_view() from public;
commit;
