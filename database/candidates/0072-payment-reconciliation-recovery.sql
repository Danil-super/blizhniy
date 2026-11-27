-- One operator-authorized retry budget for an already-linked, exhausted TEST order.
begin;
set local lock_timeout='3s';
set local statement_timeout='10s';

create table app.payment_reconciliation_recoveries (
 request_id uuid primary key,
 intent_id uuid not null unique references app.payment_reconciliation_jobs(intent_id) on delete restrict,
 operator_id uuid not null references app.users(id) on delete restrict,
 shop_id text not null,
 reason text not null,
 recorded_at timestamptz not null check(isfinite(recorded_at)),
 transaction_id xid8 not null
);
create trigger payment_reconciliation_recovery_immutable before update or delete on app.payment_reconciliation_recoveries
 for each row execute function app.reject_payment_intent_mutation();
create trigger payment_reconciliation_recovery_truncate before truncate on app.payment_reconciliation_recoveries
 for each statement execute function app.reject_payment_intent_mutation();
alter table app.payment_reconciliation_recoveries enable always trigger payment_reconciliation_recovery_immutable;
alter table app.payment_reconciliation_recoveries enable always trigger payment_reconciliation_recovery_truncate;

create function app.require_reconciliation_administrator(p_session text,p_admin uuid) returns void
 language plpgsql volatile set search_path='' as $$
declare version bigint;
begin
 if p_session is null or p_session !~ '^[a-f0-9]{64}$' or p_admin is null then
  raise exception 'Administrator session required' using errcode='42501';end if;
 select auth_version into version from app.users where id=p_admin and role='admin' and not is_blocked
  and email_verified_at is not null for update nowait;
 if not found then raise exception 'Administrator session required' using errcode='42501';end if;
 perform token_hash from app.sessions where token_hash=p_session and user_id=p_admin and auth_version=version and scope='app'
  and expires_at>pg_catalog.clock_timestamp() and last_seen_at>pg_catalog.clock_timestamp()-interval '30 minutes' for update nowait;
 if not found then raise exception 'Administrator session required' using errcode='42501';end if;
end $$;

create function app.read_payment_reconciliation_recovery_status(p_session text,p_admin uuid,p_shop text)
 returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare report jsonb; observed_at timestamptz;
begin
 if pg_catalog.current_setting('transaction_isolation')<>'read committed' then
  raise exception 'Recovery requires read committed' using errcode='PRQ04';end if;
 perform app.require_reconciliation_administrator(p_session,p_admin);
 if p_shop is null or p_shop !~ '^[a-zA-Z0-9_-]{1,64}$' then
  raise exception 'Invalid recovery shop' using errcode='22023';end if;
 observed_at:=pg_catalog.clock_timestamp();
 with active as materialized (
  select q.intent_id,q.state,q.attempts,q.last_code,q.created_at,q.next_attempt_at
  from app.payment_reconciliation_jobs q join app.payment_checkout_intents i on i.id=q.intent_id
  where i.is_test and i.merchant_shop_id=p_shop and q.state in ('queued','processing','waiting_phone','blocked')
 ), totals as (
  select count(*) filter(where state='queued' or state='processing') as open,
   count(*) filter(where state='waiting_phone') as waiting,
   count(*) filter(where state='blocked') as blocked,
   min(created_at) filter(where state='queued' or state='processing') as oldest
  from active
 ), recent as (
  select q.intent_id,q.attempts,q.last_code,q.created_at,q.next_attempt_at,r.request_id is not null as recovered
  from active q left join app.payment_reconciliation_recoveries r on r.intent_id=q.intent_id
  where q.state='blocked' order by q.next_attempt_at desc,q.intent_id limit 50
 )
 select pg_catalog.jsonb_build_object('queuedOrProcessing',totals.open,'waitingPhone',totals.waiting,'blocked',totals.blocked,
  'oldestQueueAgeSeconds',case when totals.oldest is not null then greatest(0,extract(epoch from (observed_at-totals.oldest)))::bigint end,
  'recentBlocked',coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
   'intentId',intent_id,'attempts',attempts,'code',last_code,'alreadyRecovered',recovered,
   'queueAgeSeconds',greatest(0,extract(epoch from (observed_at-created_at)))::bigint) order by next_attempt_at desc,intent_id) from recent),'[]'::jsonb))
  into report from totals;
 return report;
end $$;

create function app.recover_payment_reconciliation(p_session text,p_admin uuid,p_request uuid,p_intent uuid,p_shop text,p_reason text,p_write boolean)
 returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare
 previous app.payment_reconciliation_recoveries;
 payer uuid;
 purchase app.payment_checkout_intents;
 checkout app.payment_orders;
 current_job app.payment_reconciliation_jobs;
 available boolean:=false;
 opened_at timestamptz;
begin
 if pg_catalog.current_setting('transaction_isolation')<>'read committed' then
  raise exception 'Recovery requires read committed' using errcode='PRQ04';end if;
 perform app.require_reconciliation_administrator(p_session,p_admin);

 if p_request is null or p_intent is null or p_write is null or p_shop is null or p_shop !~ '^[a-zA-Z0-9_-]{1,64}$'
  or p_reason is null or p_reason<>pg_catalog.btrim(p_reason) or pg_catalog.char_length(p_reason) not between 1 and 500
  or p_reason ~ '[[:cntrl:]]' or p_reason ~ U&'[\061C\200E\200F\202A-\202E\2066-\2069]'
  or p_reason ~* '<[[:space:]]*(/?[a-z][^<>]*|![^<>]*|[?][^<>]*)>' then
  raise exception 'Invalid recovery request' using errcode='22023';end if;
 select * into previous from app.payment_reconciliation_recoveries where request_id=p_request;
 if found then
  if row(previous.operator_id,previous.intent_id,previous.shop_id,previous.reason) is distinct from row(p_admin,p_intent,p_shop,p_reason) then
   raise exception 'Recovery request conflict' using errcode='PRQ02';end if;
  opened_at:=previous.recorded_at;
 elsif not p_write then return null;
 else
  -- Financial operations lock the immutable intent before the order. The worker claims the queue separately.
  select owner_id into payer from app.payment_checkout_intents where id=p_intent and is_test and merchant_shop_id=p_shop;
  perform id from app.users where id=payer and not is_blocked and email_verified_at is not null for update nowait;
  if not found then raise exception 'Payment unavailable for recovery' using errcode='PRQ01';end if;
  select * into purchase from app.payment_checkout_intents where id=p_intent for update nowait;
  select * into checkout from app.payment_orders where id=p_intent for update nowait;
  if not found or checkout.status not in ('created','pending','succeeded') or
   row(checkout.owner_id,checkout.target_type,checkout.target_id,checkout.target_revision)
    is distinct from row(purchase.owner_id,purchase.target_type,purchase.target_id,purchase.target_revision) then
   raise exception 'Payment unavailable for recovery' using errcode='PRQ01';end if;
  if pg_catalog.to_regclass('app.payment_refund_reservations') is not null then
   if exists(select 1 from app.payment_refund_reservations where payment_intent_id=p_intent) then
    raise exception 'Refund reservation prevents recovery' using errcode='PRQ01';end if;
  end if;

  -- A committed fulfillment can be recognized again without changing the target or its receipt.
  if purchase.target_type='application' and checkout.status='succeeded'
   and pg_catalog.to_regclass('app_response.deliveries') is not null then
   available:=exists(select 1 from app_response.deliveries where intent_id=p_intent and application_id=purchase.target_id);
  end if;
  if purchase.target_type in ('listing','vacancy','workRequest','specialist') and checkout.status='succeeded'
   and exists(select 1 from app.payment_fulfillments where intent_id=p_intent) then
   available:=true;
  end if;
  if not available then
   case purchase.target_type
    when 'listing' then
     perform id from app.listings where id=purchase.target_id and author_id=payer and revision=purchase.target_revision
      and status='draft' and not is_paid for update nowait;
     available:=found;
     if available and pg_catalog.to_regclass('app.listing_blocks') is not null then
      available:=not exists(select 1 from app.listing_blocks where listing_id=purchase.target_id);
     end if;
    when 'vacancy','workRequest' then
     perform id from app.work_publications where id=purchase.target_id and author_id=payer and revision=purchase.target_revision
      and kind=purchase.target_type and status='draft' and not is_paid and deleted_at is null for update nowait;
     available:=found;
    when 'specialist' then
     if pg_catalog.to_regclass('app.specialist_checkout_terms') is not null then
      perform s.id from app.service_publications s join app.specialist_checkout_terms t on t.intent_id=p_intent
       where s.id=purchase.target_id and s.author_id=payer and s.revision=purchase.target_revision
       and s.kind='specialist' and s.status='draft' and not s.is_paid and s.deleted_at is null for update of s nowait;
      available:=found;
     end if;
    when 'application' then
     if pg_catalog.to_regclass('app_response.admissions') is not null then
      perform a.id from app.applications a join app_response.admissions d on d.intent_id=p_intent
       and d.applicant_id=a.applicant_id and d.shop_id=p_shop
       join app.work_publications w on w.id=a.work_publication_id
       where a.id=purchase.target_id and a.applicant_id=payer and a.revision=purchase.target_revision
        and a.status='pending_payment' and not a.is_paid and w.status='published' and w.deleted_at is null
       for update of a,w nowait;
      available:=found;
     end if;
    else null;
   end case;
  end if;
  if not available then raise exception 'Target unavailable for recovery' using errcode='PRQ01';end if;
  select * into current_job from app.payment_reconciliation_jobs where intent_id=p_intent for update nowait;
  if not found or current_job.state<>'blocked' or current_job.last_code is distinct from 'attempts_exhausted'
   or current_job.attempts<>12 or exists(select 1 from app.payment_reconciliation_recoveries where intent_id=p_intent) then
   raise exception 'Job unavailable for recovery' using errcode='PRQ02';end if;
  perform token_hash from app.sessions where token_hash=p_session and user_id=p_admin
   and expires_at>pg_catalog.clock_timestamp() and last_seen_at>pg_catalog.clock_timestamp()-interval '30 minutes';
  if not found then raise exception 'Administrator session expired' using errcode='42501';end if;
  opened_at:=pg_catalog.clock_timestamp();
  insert into app.payment_reconciliation_recoveries(request_id,intent_id,operator_id,shop_id,reason,recorded_at,transaction_id)
   values(p_request,p_intent,p_admin,p_shop,p_reason,opened_at,pg_catalog.pg_current_xact_id());
  update app.payment_reconciliation_jobs set state='queued',attempts=9,claim_id=null,lease_until=null,
   last_code=null,next_attempt_at=opened_at where intent_id=p_intent;
 end if;
 return pg_catalog.jsonb_build_object('requestId',p_request,'intentId',p_intent,'state','scheduled','recordedAt',
  pg_catalog.to_char(opened_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));
end $$;

create or replace function app.guard_payment_reconciliation_job() returns trigger
 language plpgsql set search_path='' as $$
begin
 if tg_op='DELETE' then raise exception using errcode='23514',message='Reconciliation work cannot be discarded';end if;
 if tg_op='INSERT' then
  if new.state<>'queued' or new.attempts<>0 or new.claim_id is not null or new.lease_until is not null or new.last_code is not null then
   raise exception using errcode='23514',message='Invalid initial reconciliation work';end if;
  new.created_at:=pg_catalog.clock_timestamp();new.next_attempt_at:=new.created_at;return new;
 end if;
 if new.intent_id<>old.intent_id or new.created_at<>old.created_at or old.state='completed' then
  raise exception using errcode='23514',message='Reconciliation identity and terminal state are immutable';end if;
 if old.state='blocked' then
  if current_user<>pg_catalog.pg_get_userbyid((select proowner from pg_catalog.pg_proc
   where oid='app.recover_payment_reconciliation(text,uuid,uuid,uuid,text,text,boolean)'::regprocedure)) then
   raise exception using errcode='23514',message='Only audited recovery may reopen exhausted reconciliation';end if;
  if old.last_code is distinct from 'attempts_exhausted' or old.attempts<>12 or new.state<>'queued' or new.attempts<>9
   or new.claim_id is not null or new.lease_until is not null or new.last_code is not null
   or not exists(select 1 from app.payment_reconciliation_recoveries
    where intent_id=old.intent_id and recorded_at=new.next_attempt_at and transaction_id=pg_catalog.pg_current_xact_id_if_assigned()) then
   raise exception using errcode='23514',message='Only audited recovery may reopen exhausted reconciliation';end if;
 end if;
 return new;
end $$;

create function app.preserve_reconciliation_recovery_budget() returns trigger
 language plpgsql security definer set search_path='' as $$
begin
 -- The phone wait can still pause and wake this job, but cannot renew the recovery budget.
 if old.state<>'blocked' and new.attempts<old.attempts
  and exists(select 1 from app.payment_reconciliation_recoveries where intent_id=old.intent_id) then
  if old.state='processing' and new.state in ('queued','waiting_phone') and new.last_code='phone_required' and new.attempts=0 then
   new.attempts:=old.attempts;
  else
   raise exception using errcode='23514',message='Recovery attempts cannot be reset';
  end if;
 end if;
 return new;
end $$;
create trigger reconciliation_recovery_phone_budget before update on app.payment_reconciliation_jobs
 for each row execute function app.preserve_reconciliation_recovery_budget();
alter table app.payment_reconciliation_jobs enable always trigger reconciliation_recovery_phone_budget;
revoke all on app.payment_reconciliation_recoveries from public;
revoke all on function app.recover_payment_reconciliation(text,uuid,uuid,uuid,text,text,boolean),
 app.preserve_reconciliation_recovery_budget(), app.require_reconciliation_administrator(text,uuid),
 app.read_payment_reconciliation_recovery_status(text,uuid,text) from public;
commit;
