begin;
set local lock_timeout='3s';
set local statement_timeout='10s';

create schema app_push;
revoke all on schema app_push from public;

create table app_push.subscriptions(
 id uuid primary key default gen_random_uuid(),
 session_hash text not null unique references app.sessions(token_hash) on delete cascade,
 endpoint text not null unique check(length(endpoint) between 1 and 2048),
 p256dh text not null check(p256dh ~ '^[A-Za-z0-9_-]{87}$'),
 auth text not null check(auth ~ '^[A-Za-z0-9_-]{22}$'),
 consented_at timestamptz not null default clock_timestamp(),
 expires_at timestamptz check(isfinite(expires_at))
);
revoke all on table app_push.subscriptions from public;

create function app_push.current_owner(session_key text) returns uuid
language sql volatile set search_path=pg_catalog,pg_temp as $$
 select u.id from app.sessions s join app.users u on u.id=s.user_id
 where s.token_hash=session_key and s.scope='app' and s.auth_version=u.auth_version
  and s.expires_at>clock_timestamp() and s.last_seen_at>clock_timestamp()-interval '30 minutes'
  and u.email_verified_at is not null and not u.is_blocked;
$$;

create function app_push.preference_enabled(owner_id uuid) returns boolean
language sql stable set search_path=pg_catalog,pg_temp as $$
 select exists(select 1 from app.cabinet_profiles where user_id=owner_id and profile->'pushNotifications'='true'::jsonb);
$$;

create function app_push.subscription_state(session_key text,owner_id uuid) returns text
language sql stable security definer set search_path=pg_catalog,pg_temp as $$
 select case
  when owner_id is null or app_push.current_owner(session_key) is distinct from owner_id then 'unauthenticated'
  when not app_push.preference_enabled(owner_id) then 'preference_off'
  when exists(select 1 from app_push.subscriptions where session_hash=session_key
   and (expires_at is null or expires_at>statement_timestamp())) then 'active'
  else 'ready' end;
$$;

-- Changing consent follows the auth user -> session lock order. Null endpoint removes this session's device.
create function app_push.set_subscription(session_key text,owner_id uuid,address text,public_key text,auth_key text,browser_expiry timestamptz)
returns text language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
begin
 if owner_id is null or app_push.current_owner(session_key) is distinct from owner_id then return 'unauthenticated';end if;
 perform 1 from app.users where id=owner_id for update;
 perform 1 from app.sessions where token_hash=session_key for update;
 if app_push.current_owner(session_key) is distinct from owner_id then return 'unauthenticated';end if;
 if address is null then
  delete from app_push.subscriptions where session_hash=session_key;
  return 'ok';
 end if;
 if not app_push.preference_enabled(owner_id) then return 'preference_off';end if;
 if browser_expiry<=clock_timestamp() then return 'expired';end if;
 insert into app_push.subscriptions as old(session_hash,endpoint,p256dh,auth,expires_at)
 values(session_key,address,public_key,auth_key,browser_expiry)
 on conflict(session_hash) do update set
  id=case when (old.endpoint,old.p256dh,old.auth)=(excluded.endpoint,excluded.p256dh,excluded.auth)
     and (old.expires_at is null or old.expires_at>clock_timestamp()) then old.id else gen_random_uuid() end,
  consented_at=clock_timestamp(),endpoint=excluded.endpoint,p256dh=excluded.p256dh,auth=excluded.auth,expires_at=excluded.expires_at;
 return 'ok';
exception when unique_violation then
 return 'conflict';
end $$;

-- Service workers may check consent without extending the browser's authenticated session.
create function app_push.may_display(session_key text,subscription_id uuid) returns boolean
language sql stable security definer set search_path=pg_catalog,pg_temp as $$
 select app_push.preference_enabled(app_push.current_owner(session_key)) and exists(
  select 1 from app_push.subscriptions where session_hash=session_key and id=subscription_id
   and (expires_at is null or expires_at>statement_timestamp())
 );
$$;

revoke all on function app_push.current_owner(text),app_push.preference_enabled(uuid),app_push.subscription_state(text,uuid),
 app_push.set_subscription(text,uuid,text,text,text,timestamptz),app_push.may_display(text,uuid) from public;
commit;
