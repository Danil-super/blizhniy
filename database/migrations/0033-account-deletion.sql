-- Additive, opt-in request intake/manual decisions. Does not erase account or financial data.
begin;
set local lock_timeout='3s';
set local statement_timeout='10s';
create table app.account_deletion_requests (
 id uuid primary key default gen_random_uuid(),
 user_id uuid references app.users(id) on delete set null,
 status text not null default 'requested' check(status in ('requested','in_review','resolved')),
 revision bigint not null default 1 check(revision>=1),
 requested_at timestamptz not null default clock_timestamp(),
 review_started_at timestamptz,
 resolved_at timestamptz,
 resolution text check(resolution in ('fulfilled','partly_retained','declined')),
 case_reference text check(case_reference ~ '^[A-Za-z0-9_-]{6,80}$'),
 check(isfinite(requested_at) and (review_started_at is null or (isfinite(review_started_at) and review_started_at>=requested_at))
  and (resolved_at is null or (isfinite(resolved_at) and resolved_at>=review_started_at))),
 check((status='requested' and review_started_at is null and resolved_at is null and resolution is null and case_reference is null)
  or (status='in_review' and review_started_at is not null and resolved_at is null and resolution is null and case_reference is null)
  or (status='resolved' and review_started_at is not null and resolved_at is not null and resolution is not null and case_reference is not null))
);
create unique index account_deletion_one_active on app.account_deletion_requests(user_id) where status in ('requested','in_review');
create index account_deletion_owner_latest on app.account_deletion_requests(user_id,requested_at desc,id desc);
create table app.account_deletion_events (
 id uuid primary key default gen_random_uuid(),
 request_id uuid not null references app.account_deletion_requests(id),
 -- Pseudonymous audit IDs deliberately have no FK to a removable account.
 actor_id uuid not null,
 status text not null check(status in ('requested','in_review','resolved')),
 resolution text,
 case_reference text,
 created_at timestamptz not null default clock_timestamp()
);
create function app.guard_account_deletion_request() returns trigger language plpgsql
set search_path='' as $$
declare actor uuid; actor_row record;
begin
 if tg_op='DELETE' then raise exception 'Deletion case is immutable' using errcode='42501';end if;
 if tg_op='UPDATE' and new.user_id is null and old.user_id is not null
  and not exists(select 1 from app.users where id=old.user_id)
  and (to_jsonb(new)-'user_id')=(to_jsonb(old)-'user_id') then return new;end if;
 actor:=nullif(pg_catalog.current_setting('blizhniy.deletion_actor',true),'')::uuid;
 select id,role,is_blocked,email_verified_at into actor_row from app.users where id=actor;
 if not found or actor_row.email_verified_at is null then raise exception 'Deletion actor required' using errcode='42501';end if;
 if tg_op='INSERT' then
  if new.user_id is distinct from actor or new.status<>'requested' or new.revision<>1
   or new.review_started_at is not null or new.resolved_at is not null or new.resolution is not null or new.case_reference is not null
   then raise exception 'Only own request may be created' using errcode='42501';end if;
  new.requested_at:=pg_catalog.clock_timestamp();return new;
 end if;
 if actor_row.role<>'admin' or actor_row.is_blocked
  or new.user_id is distinct from old.user_id or new.id<>old.id or new.requested_at<>old.requested_at
  or new.review_started_at is distinct from old.review_started_at or new.resolved_at is distinct from old.resolved_at
  or new.revision<>old.revision then raise exception 'Deletion case mutation denied' using errcode='42501';end if;
 if old.status='requested' and new.status='in_review' and new.resolution is null and new.case_reference is null then
  new.review_started_at:=pg_catalog.clock_timestamp();
 elsif old.status='in_review' and new.status='resolved' and new.resolution is not null and new.case_reference is not null then
  new.resolved_at:=pg_catalog.clock_timestamp();
 else raise exception 'Invalid deletion case transition' using errcode='23514';end if;
 new.revision:=old.revision+1;return new;
end;
$$;
create function app.audit_account_deletion_request() returns trigger language plpgsql security definer
set search_path='' as $$
begin
 if tg_op='UPDATE' and new.status=old.status then return new;end if;
 insert into app.account_deletion_events(request_id,actor_id,status,resolution,case_reference)
 values(new.id,pg_catalog.current_setting('blizhniy.deletion_actor')::uuid,new.status,new.resolution,new.case_reference);
 return new;
end;
$$;
create function app.guard_account_deletion_event() returns trigger language plpgsql set search_path='' as $$
begin raise exception 'Deletion audit is append-only' using errcode='42501';end;
$$;
create trigger account_deletion_request_guard before insert or update or delete on app.account_deletion_requests
 for each row execute function app.guard_account_deletion_request();
create trigger account_deletion_request_audit after insert or update on app.account_deletion_requests
 for each row execute function app.audit_account_deletion_request();
create trigger account_deletion_event_guard before update or delete on app.account_deletion_events
 for each row execute function app.guard_account_deletion_event();
alter table app.account_deletion_requests enable always trigger account_deletion_request_guard;
alter table app.account_deletion_requests enable always trigger account_deletion_request_audit;
alter table app.account_deletion_events enable always trigger account_deletion_event_guard;
revoke all on app.account_deletion_requests,app.account_deletion_events from public;
revoke all on function app.guard_account_deletion_request(),app.audit_account_deletion_request(),app.guard_account_deletion_event() from public;
commit;
