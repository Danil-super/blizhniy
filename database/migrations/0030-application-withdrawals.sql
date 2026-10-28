-- Local opt-in only. No automatic installer, grants or financial writes.
-- The server sets set_config('blizhniy.application_session', hashSessionToken(token), true)
-- inside withAppSessionTransaction before inserting. No hash is stored here.
-- Context is defense-in-depth against handler misuse, NOT protection against a compromised runtime database role:
-- that role already SELECTs app.sessions and can set transaction settings itself.
-- Checkout/dispatch admission must lock the same application and reject a marker;
-- this trigger alone cannot stop another writer that ignores that lock contract.
-- Intended separately approved runtime access: SELECT and
-- INSERT(application_id,owner_id,withdrawn_revision), never UPDATE/DELETE.
begin;
set local lock_timeout='3s';
set local statement_timeout='10s';
create table app.application_withdrawals (
 application_id uuid primary key references app.applications(id) on delete cascade,
 owner_id uuid not null references app.users(id) on delete cascade,
 withdrawn_revision bigint not null check (withdrawn_revision>=1),
 withdrawn_at timestamptz not null default clock_timestamp() check (isfinite(withdrawn_at))
);
create index application_withdrawals_owner_idx on app.application_withdrawals(owner_id);
create function app.guard_application_withdrawal() returns trigger
 language plpgsql security invoker set search_path='' as $$
declare
 session_hash text;
 actor record;
 item record;
begin
 if tg_op='DELETE' then
  if current_user='blizhniy_runtime' or session_user='blizhniy_runtime' then
   raise exception 'Application withdrawal is immutable' using errcode='42501';
  end if;
  -- Owner-operated account-erasure cascades may remove the marker.
  return old;
 end if;
 if tg_op<>'INSERT' then
  raise exception 'Application withdrawal is immutable' using errcode='42501';
 end if;
 session_hash:=pg_catalog.current_setting('blizhniy.application_session',true);
 if session_hash is null or session_hash !~ '^[a-f0-9]{64}$' then
  raise exception 'Application session required' using errcode='42501';
 end if;
 -- Follow the server user -> session -> resource lock order. User/session
 -- locks prevent concurrent revocation; clock checks below cover lock waits.
 select id,is_blocked,email_verified_at,auth_version into actor
  from app.users where id=new.owner_id for share;
 if not found or actor.is_blocked or actor.email_verified_at is null then
  raise exception 'Application session required' using errcode='42501';
 end if;
 perform token_hash from app.sessions where token_hash=session_hash and user_id=new.owner_id
  and auth_version=actor.auth_version and scope='app'
  and expires_at>pg_catalog.clock_timestamp()
  and last_seen_at>pg_catalog.clock_timestamp()-interval '30 minutes' for share;
 if not found then
  raise exception 'Application session required' using errcode='42501';
 end if;
 select applicant_id,revision,is_paid,sent_at,status into item
  from app.applications where id=new.application_id for update;
 if not found or item.applicant_id<>new.owner_id or item.revision<>new.withdrawn_revision
  or item.is_paid or item.sent_at is not null or item.status<>'pending_payment' then
  raise exception 'Only own unchanged unpaid application can be withdrawn' using errcode='42501';
 end if;
 -- UNKNOWN never becomes editable merely because time passed. Include
 -- succeeded orders even when delivery has not yet been committed.
 if exists(select 1 from app.payment_orders where target_type='application'
  and target_id=new.application_id and status in ('created','pending','succeeded')) then
  raise exception 'Application payment must be resolved first' using errcode='23514';
 end if;
 -- expires_at is the schema's absolute expiry (bounded to created_at + 8h).
 -- Recheck after any resource wait, using wall clock rather than transaction time.
 perform token_hash from app.sessions where token_hash=session_hash and user_id=new.owner_id
  and auth_version=actor.auth_version and scope='app'
  and expires_at>pg_catalog.clock_timestamp()
  and last_seen_at>pg_catalog.clock_timestamp()-interval '30 minutes';
 if not found then
  raise exception 'Application session required' using errcode='42501';
 end if;
 new.withdrawn_at:=pg_catalog.clock_timestamp();
 return new;
end;
$$;
create trigger application_withdrawal_guard before insert or update or delete on app.application_withdrawals
 for each row execute function app.guard_application_withdrawal();
alter table app.application_withdrawals enable always trigger application_withdrawal_guard;
revoke all on app.application_withdrawals from public;
revoke all on function app.guard_application_withdrawal() from public;
commit;
