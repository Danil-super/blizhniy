-- Candidate only. No role/grant installation, startup application or production activation.
begin;
set local lock_timeout='3s';
set local statement_timeout='10s';

create table app.admin_user_changes (
 id uuid primary key,
 actor_id uuid not null,
 target_id uuid not null,
 expected_version bigint not null check(expected_version>=0),
 previous_role text not null check(previous_role in ('user','admin')),
 role text not null check(role in ('user','admin')),
 previous_blocked boolean not null,
 is_blocked boolean not null,
 resulting_version bigint not null check(resulting_version>=0),
 reason text not null check(char_length(reason) between 3 and 500 and reason=btrim(reason)
  and reason !~ U&'[\0001-\001F\007F-\009F\061C\200E\200F\202A-\202E\2066-\2069]'),
 changed boolean not null,
 created_at timestamptz not null default clock_timestamp() check(isfinite(created_at)),
 check(changed=(previous_role<>role or previous_blocked<>is_blocked)),
 check(resulting_version::numeric=expected_version::numeric+case when changed then 1 else 0 end)
);
create index admin_user_changes_target_idx on app.admin_user_changes(target_id,created_at desc,id desc);
revoke all on app.admin_user_changes from public;

create function app.guard_admin_user_changes() returns trigger
 language plpgsql set search_path=pg_catalog as $$
begin
 raise exception using errcode='23514',message='User access receipts are immutable';
end;
$$;
revoke all on function app.guard_admin_user_changes() from public;
create trigger admin_user_changes_immutable before update or delete or truncate on app.admin_user_changes
 for each statement execute function app.guard_admin_user_changes();

create function app.admin_user_access(p_session_hash text,p_actor uuid,p_action text,p_target uuid,
 p_operation uuid,p_expected bigint,p_role text,p_blocked boolean,p_reason text) returns jsonb
 language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare
 actor app.users%rowtype; target app.users%rowtype; saved app.admin_user_changes%rowtype;
 did_change boolean; answer jsonb; refresh_count integer;
begin
 if session_user<>'blizhniy_user_operator' or current_setting('transaction_isolation')<>'read committed' then
  raise exception using errcode='PUA01',message='Admin access required';end if;
 if p_session_hash is null or p_session_hash !~ '^[a-f0-9]{64}$' or p_actor is null then
  raise exception using errcode='PUA01',message='Admin access required';end if;
 if p_action is null or p_action not in ('inspect','change','recover') or p_target is null or
  (p_action='inspect' and (p_operation is not null or p_expected is not null or p_role is not null or p_blocked is not null or p_reason is not null)) or
  (p_action='recover' and (p_operation is null or p_expected is not null or p_role is not null or p_blocked is not null or p_reason is not null)) or
  (p_action='change' and (p_operation is null or p_expected is null or p_expected<0 or p_role is null or p_role not in ('user','admin') or
   p_blocked is null or p_reason is null or char_length(p_reason) not between 3 and 500 or p_reason<>btrim(p_reason) or
   p_reason ~ U&'[\0001-\001F\007F-\009F\061C\200E\200F\202A-\202E\2066-\2069]' or
   p_reason ~ '<[[:space:]]*(/?[[:alpha:]][^<>]*|![^<>]*|[?][^<>]*)>')) then
  raise exception using errcode='PUA08',message='Invalid user access command';end if;

 -- Authenticate before taking locks or exposing target existence/contention.
 perform u.id from app.users u join app.sessions s on s.user_id=u.id
  where u.id=p_actor and u.role='admin' and not u.is_blocked and u.email_verified_at is not null
   and s.token_hash=p_session_hash and s.auth_version=u.auth_version and s.scope='app'
   and s.expires_at>clock_timestamp() and s.last_seen_at>clock_timestamp()-interval '30 minutes';
 if not found then raise exception using errcode='PUA01',message='Admin access required';end if;
 if p_action='change' and not pg_try_advisory_xact_lock(187924,61) then
  raise exception using errcode='55P03',message='User access change busy';end if;
 -- Both rows NOWAIT avoid cross-admin cycles with other user-first transactions.
 perform id from app.users where id in (p_actor,p_target) order by id for update nowait;
 select * into actor from app.users where id=p_actor and role='admin' and not is_blocked and email_verified_at is not null;
 if not found then raise exception using errcode='PUA01',message='Admin access required';end if;
 perform token_hash from app.sessions where token_hash=p_session_hash and user_id=actor.id and auth_version=actor.auth_version and scope='app'
  and expires_at>clock_timestamp() and last_seen_at>clock_timestamp()-interval '30 minutes' for update nowait;
 if not found then raise exception using errcode='PUA01',message='Admin access required';end if;
 select * into target from app.users where id=p_target;
 if not found then raise exception using errcode='PUA06',message='User unavailable';end if;

 if p_action='recover' then
  select * into saved from app.admin_user_changes where id=p_operation;
  if found and (saved.actor_id<>actor.id or saved.target_id<>target.id) then
   raise exception using errcode='PUA02',message='Operation ID already used';end if;
 end if;
 if p_action='change' then
  select * into saved from app.admin_user_changes where id=p_operation;
  if found then
   if saved.actor_id<>actor.id or saved.target_id<>target.id or saved.expected_version<>p_expected or
    saved.role<>p_role or saved.is_blocked<>p_blocked or saved.reason<>p_reason then
    raise exception using errcode='PUA02',message='Operation ID already used';end if;
  else
   if target.auth_version<>p_expected then raise exception using errcode='PUA03',message='User access changed';end if;
   did_change:=target.role<>p_role or target.is_blocked<>p_blocked;
   if did_change then
    if target.role='admin' and not target.is_blocked and target.email_verified_at is not null and (p_role<>'admin' or p_blocked) and
     not exists(select 1 from app.users where id<>target.id and role='admin' and not is_blocked and email_verified_at is not null) then
     raise exception using errcode='PUA04',message='Last administrator required';end if;
    if target.id=actor.id then raise exception using errcode='PUA05',message='Own access cannot be changed';end if;
    if target.role<>'admin' and p_role='admin' and (target.email_verified_at is null or p_blocked) then
     raise exception using errcode='PUA07',message='Verified active user required';end if;
    if target.auth_version=9223372036854775807 then raise exception using errcode='PUA03',message='User access changed';end if;
    update app.users set role=p_role,is_blocked=p_blocked,auth_version=auth_version+1 where id=target.id;
   end if;
   insert into app.admin_user_changes(id,actor_id,target_id,expected_version,previous_role,role,previous_blocked,is_blocked,resulting_version,reason,changed)
    values(p_operation,actor.id,target.id,p_expected,target.role,p_role,target.is_blocked,p_blocked,
     target.auth_version+case when did_change then 1 else 0 end,p_reason,did_change);
  end if;
 end if;

 -- Shape one bounded set for the recent journal and any historical replay receipt.
 with bounded as (
  (select * from app.admin_user_changes where target_id=p_target order by created_at desc,id desc limit 10)
  union
  (select * from app.admin_user_changes where id=p_operation)
 ), receipts as (
  select id,actor_id as "actorId",target_id as "targetId",expected_version::text as "expectedVersion",previous_role as "previousRole",role,
   previous_blocked as "previousBlocked",is_blocked as "isBlocked",resulting_version::text as "resultingVersion",reason,changed,
   to_char(created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "createdAt" from bounded
 ) select jsonb_build_object(
  'user',(select jsonb_build_object('id',id,'role',role,'isBlocked',is_blocked,'emailVerified',email_verified_at is not null,'authVersion',auth_version::text) from app.users where id=p_target),
  'receipt',(select to_jsonb(r) from receipts r where id=p_operation),
  'history',coalesce((select jsonb_agg(to_jsonb(r)) from (select * from receipts order by "createdAt" desc,id desc limit 10) r),'[]'::jsonb)) into answer;

 update app.sessions set last_seen_at=least(clock_timestamp(),expires_at)
  where token_hash=p_session_hash and user_id=actor.id and auth_version=actor.auth_version and scope='app'
   and expires_at>clock_timestamp() and last_seen_at>clock_timestamp()-interval '30 minutes';
 get diagnostics refresh_count=row_count;
 if refresh_count<>1 then raise exception using errcode='PUA01',message='Admin access required';end if;
 return answer;
end;
$$;
revoke all on function app.admin_user_access(text,uuid,text,uuid,uuid,bigint,text,boolean,text) from public;
commit;
