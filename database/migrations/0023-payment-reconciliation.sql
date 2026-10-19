-- Local opt-in only. One durable verification job per already-linked payment, no financial authority.
begin;
set local lock_timeout='3s';
set local statement_timeout='10s';
create table app.payment_reconciliation_jobs (
 intent_id uuid primary key references app.payment_provider_links(intent_id) on delete restrict,
 state text not null default 'queued' check(state in ('queued','processing','completed','blocked')),
 attempts smallint not null default 0 check(attempts between 0 and 12),
 claim_id uuid unique,
 lease_until timestamptz check(lease_until is null or isfinite(lease_until)),
 next_attempt_at timestamptz not null default clock_timestamp() check(isfinite(next_attempt_at)),
 last_code text check(last_code in ('provider_pending','capture_required','processing_unavailable','publication_blocked','attempts_exhausted')),
 created_at timestamptz not null default clock_timestamp() check(isfinite(created_at)),
 check((state='processing' and claim_id is not null and lease_until is not null and attempts>0)
  or (state<>'processing' and claim_id is null and lease_until is null)),
 check(state<>'blocked' or last_code is not null)
);
create index payment_reconciliation_ready on app.payment_reconciliation_jobs(next_attempt_at,intent_id) where state='queued';
create index payment_reconciliation_expired on app.payment_reconciliation_jobs(lease_until,intent_id) where state='processing';
create function app.guard_payment_reconciliation_job() returns trigger
 language plpgsql set search_path='' as $$ begin
 if tg_op='DELETE' then raise exception using errcode='23514',message='Reconciliation work cannot be discarded';end if;
 if tg_op='INSERT' then
  if new.state<>'queued' or new.attempts<>0 or new.claim_id is not null or new.lease_until is not null or new.last_code is not null then
   raise exception using errcode='23514',message='Invalid initial reconciliation work';end if;
  new.created_at:=pg_catalog.clock_timestamp();new.next_attempt_at:=new.created_at;return new;
 end if;
 if new.intent_id<>old.intent_id or new.created_at<>old.created_at or old.state in ('completed','blocked') then
  raise exception using errcode='23514',message='Reconciliation identity and terminal state are immutable';end if;
 return new;
end $$;
create trigger payment_reconciliation_guard before insert or update or delete on app.payment_reconciliation_jobs
 for each row execute function app.guard_payment_reconciliation_job();
revoke all on app.payment_reconciliation_jobs from public;
revoke all on function app.guard_payment_reconciliation_job() from public;
commit;
