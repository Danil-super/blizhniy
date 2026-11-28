-- Candidate only. Requires the trusted verifier and the new operator preflight before hosted admission.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '10s';

create table app_admin_passkey.user_access_permits (
  session_hash text primary key references app.sessions(token_hash) on delete cascade,
  auth_version bigint not null check (auth_version >= 0),
  credential_id text not null references app_admin_passkey.credentials(id) on delete cascade,
  command jsonb not null check (jsonb_typeof(command) = 'array' and jsonb_array_length(command) = 7),
  expires_at timestamptz not null check (isfinite(expires_at))
);
revoke all on app_admin_passkey.user_access_permits from public;

alter function app_admin.user_access(text,uuid,text,uuid,uuid,bigint,text,boolean,text)
  rename to user_access_before_passkey;
revoke all on function app_admin.user_access_before_passkey(text,uuid,text,uuid,uuid,bigint,text,boolean,text)
  from public, blizhniy_user_operator;

do $$
begin
  if exists (select 1 from pg_proc
    where oid='app_admin.user_access_before_passkey(text,uuid,text,uuid,uuid,bigint,text,boolean,text)'::regprocedure
      and proowner<>current_user::regrole::oid)
    or has_function_privilege('blizhniy_user_operator',
      'app_admin.user_access_before_passkey(text,uuid,text,uuid,uuid,bigint,text,boolean,text)','EXECUTE') then
    raise exception 'Invalid user access migration authority';
  end if;
end;
$$;

create function app_admin.user_access(p_session_hash text,p_actor uuid,p_action text,p_target uuid,
  p_operation uuid,p_expected bigint,p_role text,p_blocked boolean,p_reason text) returns jsonb
  language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare
  intended jsonb;
  approved_key text;
  answer jsonb;
begin
  if session_user<>'blizhniy_user_operator' or current_setting('transaction_isolation')<>'read committed' then
    raise exception using errcode='PUA01',message='Admin access required';
  end if;
  if p_action is distinct from 'change' then
    return app_admin.user_access_before_passkey(p_session_hash,p_actor,p_action,p_target,p_operation,p_expected,p_role,p_blocked,p_reason);
  end if;

  intended:=jsonb_build_array(p_actor,p_target,p_operation,p_expected::text,p_role,p_blocked,p_reason);
  select permit.credential_id into approved_key from app_admin_passkey.user_access_permits permit
    where permit.session_hash=p_session_hash and permit.command=intended and permit.expires_at>clock_timestamp();
  if not found then
    raise exception using errcode='PUA09',message='Administrator passkey approval required';
  end if;

  -- Preserve the legacy actor/target/session lock order. Any later error rolls back the mutation and its receipt.
  answer:=app_admin.user_access_before_passkey(p_session_hash,p_actor,p_action,p_target,p_operation,p_expected,p_role,p_blocked,p_reason);
  perform id from app_admin_passkey.credentials
    where id=approved_key and admin_id=p_actor and revoked_at is null for update;
  if not found then
    raise exception using errcode='PUA09',message='Administrator passkey approval required';
  end if;
  delete from app_admin_passkey.user_access_permits permit
    where permit.session_hash=p_session_hash and permit.command=intended and permit.credential_id=approved_key
      and permit.expires_at>clock_timestamp()
      and exists (
        select 1 from app.sessions s join app.users u on u.id=s.user_id
        where s.token_hash=permit.session_hash and s.user_id=p_actor and s.scope='app'
          and s.auth_version=permit.auth_version and u.auth_version=s.auth_version
          and u.role='admin' and not u.is_blocked and u.email_verified_at is not null
          and s.expires_at>clock_timestamp() and s.last_seen_at>clock_timestamp()-interval '30 minutes'
      );
  if not found then
    raise exception using errcode='PUA09',message='Administrator passkey approval required';
  end if;
  return answer;
end;
$$;
revoke all on function app_admin.user_access(text,uuid,text,uuid,uuid,bigint,text,boolean,text) from public;
grant execute on function app_admin.user_access(text,uuid,text,uuid,uuid,bigint,text,boolean,text) to blizhniy_user_operator;

commit;
