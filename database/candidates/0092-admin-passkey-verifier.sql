-- Candidate only. Provision the isolated blizhniy_passkey_verifier role separately.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '10s';

do $$
begin
  if not exists (
    select 1 from pg_roles r
      where r.rolname='blizhniy_passkey_verifier' and not (
        r.rolsuper or r.rolcreaterole or r.rolcreatedb or r.rolinherit or r.rolreplication or r.rolbypassrls)
        and r.rolconnlimit=4 and not exists (
          select 1 from pg_auth_members m where m.roleid=r.oid or m.member=r.oid)
  ) then raise exception 'Invalid passkey verifier role'; end if;
end;
$$;

create function app_admin_passkey.session_state(p_session text,p_touch boolean)
  returns table(admin_id uuid,auth_version bigint)
  language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare
  actor uuid;
  version bigint;
  expiry timestamptz;
  activity timestamptz;
  checked_at timestamptz;
begin
  if session_user<>'blizhniy_passkey_verifier' or current_setting('transaction_isolation')<>'read committed'
    or p_session is null or p_session !~ '^[a-f0-9]{64}$' or p_touch is null then return; end if;

  -- Match the account and user operator lock order: user, session, then passkey state.
  select u.id,u.auth_version into actor,version from app.users u
    where u.id=(select s.user_id from app.sessions s where s.token_hash=p_session)
      and u.role='admin' and not u.is_blocked and u.email_verified_at is not null for update of u;
  if not found then return; end if;
  select s.expires_at,s.last_seen_at into expiry,activity from app.sessions s
    where s.token_hash=p_session and s.user_id=actor and s.auth_version=version and s.scope='app' for update of s;
  if not found then return; end if;
  checked_at:=clock_timestamp();
  if expiry<=checked_at or activity<=checked_at-interval '30 minutes' then return; end if;

  if p_touch then
    update app.sessions set last_seen_at=least(checked_at,expiry) where token_hash=p_session;
  end if;
  return query select actor,version;
end;
$$;

create function app_admin_passkey.enrollment_state(p_session text,p_origin text,p_code_hash text)
  returns table(admin_id uuid,mode text,user_handle text,challenge text)
  language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare
  actor uuid;
  version bigint;
begin
  select s.admin_id,s.auth_version into actor,version
    from app_admin_passkey.session_state(p_session,false) s;
  if not found then return; end if;
  return query select e.admin_id,e.mode,e.user_handle,e.challenge from app_admin_passkey.enrollments e
    where e.admin_id=actor and e.auth_version=version and e.origin=p_origin and e.code_hash=p_code_hash
      and ((e.session_hash is null and e.expires_at>clock_timestamp())
        or (e.session_hash=p_session and e.challenge_expires_at>clock_timestamp())) for update of e;
end;
$$;

create function app_admin_passkey.bind_enrollment(p_session text,p_origin text,p_code_hash text,
  p_handle text,p_challenge text) returns boolean
  language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare
  actor uuid;
begin
  select e.admin_id into actor from app_admin_passkey.enrollment_state(p_session,p_origin,p_code_hash) e
    where e.challenge is null;
  if not found then return false; end if;
  update app_admin_passkey.enrollments
    set session_hash=p_session,user_handle=p_handle,challenge=p_challenge,
      challenge_expires_at=least(expires_at,clock_timestamp()+interval '90 seconds')
    where admin_id=actor and expires_at>clock_timestamp();
  if not found then return false; end if;
  if not exists (select 1 from app_admin_passkey.session_state(p_session,false)) then
    raise exception using errcode='PAP01',message='Administrator passkey session expired';
  end if;
  return true;
end;
$$;

create function app_admin_passkey.complete_enrollment(p_session text,p_origin text,p_code_hash text,
  p_challenge text,p_key_id text,p_key bytea,p_counter bigint) returns boolean
  language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare
  approval record;
begin
  select e.* into approval from app_admin_passkey.enrollment_state(p_session,p_origin,p_code_hash) e
    where e.challenge=p_challenge;
  if not found then return false; end if;
  if approval.mode='add' and (select count(*) from app_admin_passkey.credentials
    where admin_id=approval.admin_id and revoked_at is null)>=16 then return false; end if;

  insert into app_admin_passkey.credentials(id,admin_id,user_handle,public_key,counter)
    values(p_key_id,approval.admin_id,approval.user_handle,p_key,p_counter) on conflict(id) do nothing;
  if not found then return false; end if;
  if approval.mode='replace' then
    update app_admin_passkey.credentials set revoked_at=clock_timestamp()
      where admin_id=approval.admin_id and id<>p_key_id and revoked_at is null;
  end if;
  delete from app_admin_passkey.enrollments
    where admin_id=approval.admin_id and challenge_expires_at>clock_timestamp();
  if not found or not exists (select 1 from app_admin_passkey.session_state(p_session,false)) then
    raise exception using errcode='PAP01',message='Administrator passkey enrollment expired';
  end if;
  return true;
end;
$$;

create function app_admin_passkey.store_access_permit(p_session text,p_version bigint,
  p_credential_id text,p_command jsonb) returns boolean
  language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare
  actor uuid;
begin
  select s.admin_id into actor from app_admin_passkey.session_state(p_session,false) s
    where s.auth_version=p_version;
  if not found or p_command->>0 is distinct from actor::text then return false; end if;
  perform id from app_admin_passkey.credentials
    where id=p_credential_id and admin_id=actor and revoked_at is null for update;
  if not found then return false; end if;
  insert into app_admin_passkey.user_access_permits(session_hash,auth_version,credential_id,command,expires_at)
    values(p_session,p_version,p_credential_id,p_command,clock_timestamp()+interval '30 seconds')
    on conflict(session_hash) do update set auth_version=excluded.auth_version,credential_id=excluded.credential_id,
      command=excluded.command,expires_at=excluded.expires_at;
  if not exists (select 1 from app_admin_passkey.session_state(p_session,false)) then
    raise exception using errcode='PAP01',message='Administrator passkey session expired';
  end if;
  return true;
end;
$$;

revoke all on function app_admin_passkey.session_state(text,boolean),
  app_admin_passkey.enrollment_state(text,text,text),app_admin_passkey.bind_enrollment(text,text,text,text,text),
  app_admin_passkey.complete_enrollment(text,text,text,text,text,bytea,bigint),
  app_admin_passkey.store_access_permit(text,bigint,text,jsonb) from public;
grant usage on schema app_admin_passkey to blizhniy_passkey_verifier;
grant execute on function app_admin_passkey.session_state(text,boolean),
  app_admin_passkey.enrollment_state(text,text,text),app_admin_passkey.bind_enrollment(text,text,text,text,text),
  app_admin_passkey.complete_enrollment(text,text,text,text,text,bytea,bigint),
  app_admin_passkey.store_access_permit(text,bigint,text,jsonb) to blizhniy_passkey_verifier;
grant select (id,admin_id,user_handle,public_key,counter,created_at,revoked_at),update (counter)
  on app_admin_passkey.credentials to blizhniy_passkey_verifier;
grant select (session_hash,auth_version,kind,command_digest,credential_ids,challenge,expires_at),
  insert (session_hash,auth_version,kind,command_digest,credential_ids,challenge,expires_at),
  update (auth_version,kind,command_digest,credential_ids,challenge,expires_at),delete
  on app_admin_passkey.challenges to blizhniy_passkey_verifier;

commit;
