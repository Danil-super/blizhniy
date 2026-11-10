-- Dormant private TEST operator recovery: GET proof only, no grants or new send authority.
begin;
set local lock_timeout='3s';
set local statement_timeout='10s';
create function app.lock_refund_recovery_source(operation uuid,candidate uuid) returns jsonb
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
 elsif purchase.target_type in ('listing','vacancy','workRequest') and purchase.duration_days is not null then
  if not exists(select 1 from app.payment_refund_approvals where id=operation and payment_intent_id=purchase.id and amount=purchase.amount
   and fiscal_mode=mode and policy_version='placement-full-admin-v1') then raise exception 'Original refund approval required' using errcode='23514';end if;
 else raise exception 'Unsupported refund recovery target' using errcode='23514';end if;
 return pg_catalog.jsonb_build_object('paymentIntentId',purchase.id,'targetType',purchase.target_type,'shopId',purchase.merchant_shop_id);
end $$;
create function app.refund_recovery_actor() returns uuid
 language plpgsql security definer set search_path='' as $$
declare session_hash text;actor uuid;version bigint;
begin
 session_hash:=pg_catalog.current_setting('blizhniy.refund_recovery_session',true);
 if session_hash is null or session_hash !~ '^[a-f0-9]{64}$' then raise exception 'Administrator session required' using errcode='42501';end if;
 select user_id into actor from app.sessions where token_hash=session_hash;
 select auth_version into version from app.users where id=actor and role='admin' and not is_blocked and email_verified_at is not null for update nowait;
 if not found then raise exception 'Administrator session required' using errcode='42501';end if;
 perform token_hash from app.sessions where token_hash=session_hash and user_id=actor and auth_version=version and scope='app'
  and expires_at>pg_catalog.clock_timestamp() and last_seen_at>pg_catalog.clock_timestamp()-interval '30 minutes' for update nowait;
 if not found then raise exception 'Administrator session expired' using errcode='42501';end if;
 return actor;
end $$;
create table app.payment_refund_recovery_actions (
 action_id uuid not null,
 phase text not null check(phase in ('requested','pending','succeeded','canceled')),
 operation_id uuid not null references app.payment_refund_requests(operation_id) on delete restrict,
 provider_refund_id uuid not null,
 reason text not null,
 operator_id uuid not null references app.users(id) on delete restrict,
 payment_intent_id uuid not null references app.payment_orders(id) on delete restrict,
 merchant_shop_id text not null,
 recorded_at timestamptz not null check(isfinite(recorded_at)),
 primary key(action_id,phase)
);
create function app.guard_refund_recovery_action() returns trigger
 language plpgsql security definer set search_path='' as $$
declare actor uuid;source jsonb;prior app.payment_refund_recovery_actions;observed text;
begin
 if tg_op<>'INSERT' then raise exception 'Refund recovery audit is immutable' using errcode='42501';end if;
 if new.operator_id is not null or new.payment_intent_id is not null or new.merchant_shop_id is not null or new.recorded_at is not null or
  new.phase is null or new.phase not in ('requested','observe') or new.action_id is null or
  new.reason is null or new.reason<>pg_catalog.btrim(new.reason,U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF') or
  app.refund_utf16_length(new.reason) not between 1 and 500 or new.reason ~ '[[:cntrl:]]' or new.reason ~ U&'[\061C\200E\200F\202A-\202E\2066-\2069]' or
  new.reason ~* '<[[:space:]]*(/?[a-z][^<>]*|![^<>]*|[?][^<>]*)>' then
  raise exception 'Invalid refund recovery action' using errcode='23514';end if;
 actor:=app.refund_recovery_actor();
 source:=app.lock_refund_recovery_source(new.operation_id,new.provider_refund_id);
 -- Independent actions may share one operation; an action UUID cannot change its meaning.
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(new.action_id::text,51001));
 select * into prior from app.payment_refund_recovery_actions where action_id=new.action_id and phase='requested';
 if found and (prior.operation_id<>new.operation_id or prior.provider_refund_id<>new.provider_refund_id or prior.operator_id<>actor or prior.reason<>new.reason) then
  raise exception 'Refund recovery action conflict' using errcode='23514';end if;
 if new.phase='observe' then
  if prior.action_id is null then raise exception 'Recovery request audit required' using errcode='23514';end if;
  select o.status into observed from app.payment_refund_observations o join app.payment_refund_provider_links l
   on l.operation_id=o.operation_id and l.provider_refund_id=o.provider_refund_id
   where o.operation_id=new.operation_id and o.provider_refund_id=new.provider_refund_id
   order by case when o.status='pending' then 0 else 1 end desc limit 1;
  if observed is null then raise exception 'Verified refund result required' using errcode='23514';end if;
  if observed='succeeded' and not (
   exists(select 1 from app.payment_refund_effects where operation_id=new.operation_id and provider_refund_id=new.provider_refund_id) or
   exists(select 1 from app.application_compensation_refunds where payment_intent_id=(source->>'paymentIntentId')::uuid and provider_refund_id=new.provider_refund_id)) then
   raise exception 'Applied refund effect required' using errcode='23514';end if;
  new.phase:=observed;
 end if;
 -- Financial lock waits must not turn an expired browser session into authority.
 if app.refund_recovery_actor()<>actor then raise exception 'Administrator changed' using errcode='42501';end if;
 new.operator_id:=actor;new.payment_intent_id:=(source->>'paymentIntentId')::uuid;new.merchant_shop_id:=source->>'shopId';new.recorded_at:=pg_catalog.clock_timestamp();
 return new;
end $$;
create function app.finish_refund_recovery_job() returns trigger
 language plpgsql security definer set search_path='' as $$
begin
 if new.phase in ('succeeded','canceled') then
  update app.application_compensation_jobs set state=case when new.phase='succeeded' then 'completed' else 'blocked' end,claim_id=null,
   last_code=case when new.phase='canceled' then 'provider_canceled' else null end
   where payment_intent_id=new.payment_intent_id and merchant_shop_id=new.merchant_shop_id and state<>'completed';
 end if;
 -- A queue lock may outlive the operator session even for direct SQL callers.
 if app.refund_recovery_actor()<>new.operator_id then raise exception 'Administrator changed' using errcode='42501';end if;
 return new;
end $$;
create trigger refund_recovery_action_guard before insert or update or delete on app.payment_refund_recovery_actions for each row execute function app.guard_refund_recovery_action();
create trigger refund_recovery_truncate_guard before truncate on app.payment_refund_recovery_actions for each statement execute function app.guard_refund_recovery_action();
create trigger refund_recovery_job_finish after insert on app.payment_refund_recovery_actions for each row execute function app.finish_refund_recovery_job();
alter table app.payment_refund_recovery_actions enable always trigger refund_recovery_action_guard;
alter table app.payment_refund_recovery_actions enable always trigger refund_recovery_truncate_guard;
alter table app.payment_refund_recovery_actions enable always trigger refund_recovery_job_finish;
revoke all on app.payment_refund_recovery_actions from public;
revoke all on function app.lock_refund_recovery_source(uuid,uuid),app.refund_recovery_actor(),app.guard_refund_recovery_action(),app.finish_refund_recovery_job() from public;
commit;
