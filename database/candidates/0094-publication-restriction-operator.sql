begin;
set local lock_timeout='3s';
set local statement_timeout='10s';

-- Existing restrictions remain in force even when they predate an operator receipt.
alter table app_publication_restriction.restrictions add column restricted_by uuid;

create function app_publication_restriction.restrict(
 p_session_hash text,p_actor uuid,p_kind text,p_publication uuid,p_revision bigint,p_case uuid
) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare
 actor_version bigint;
 session_expires timestamptz;
 session_seen timestamptz;
 target_owner uuid;
 target_revision bigint;
 receipt app_publication_restriction.restrictions%rowtype;
begin
 if session_user<>'blizhniy_publication_operator' or current_setting('transaction_isolation')<>'read committed' then
  raise exception using errcode='PZR01',message='Publication moderator required';
 end if;
 if p_session_hash is null or octet_length(p_session_hash)<>64 or p_session_hash !~ '^[a-f0-9]+$'
  or p_actor is null or p_kind is null or p_kind not in ('vacancy','workRequest','specialist','fair','marquee')
  or p_publication is null or p_revision is null or p_revision<1 or p_case is null then
  raise exception using errcode='PZR02',message='Invalid publication restriction';
 end if;

 -- Use actor, session, and publication locks in the same order as checkout and moderation.
 select u.auth_version into actor_version from app.users u
  where u.id=p_actor and u.role='admin' and u.email_verified_at is not null and not u.is_blocked for update nowait;
 if not found then raise exception using errcode='PZR01',message='Publication moderator required';end if;
 select s.expires_at,s.last_seen_at into session_expires,session_seen from app.sessions s
  where s.token_hash=p_session_hash and s.user_id=p_actor and s.auth_version=actor_version and s.scope='app'
  for update nowait;
 if not found or session_expires<=clock_timestamp() or session_seen<=clock_timestamp()-interval '30 minutes' then
  raise exception using errcode='PZR01',message='Publication moderator required';
 end if;

 -- Replays return the committed receipt even if the author has since removed the card.
 select r.* into receipt from app_publication_restriction.restrictions r where r.case_id=p_case;
 if found then
  if row(receipt.kind,receipt.publication_id,receipt.restricted_revision,receipt.restricted_by)
     is distinct from row(p_kind,p_publication,p_revision,p_actor) then
   raise exception using errcode='PZR04',message='Publication restriction conflict';
  end if;
 else
  if p_kind in ('vacancy','workRequest') then
   select w.author_id,w.revision into target_owner,target_revision from app.work_publications w
    where w.id=p_publication and w.kind=p_kind and w.deleted_at is null for update nowait;
  else
   select s.author_id,s.revision into target_owner,target_revision from app.service_publications s
    where s.id=p_publication and s.kind=p_kind and s.deleted_at is null for update nowait;
  end if;
  if not found then raise exception using errcode='PZR03',message='Publication not found';end if;
  if target_owner=p_actor then raise exception using errcode='PZR01',message='Publication moderator required';end if;
  if target_revision<>p_revision then raise exception using errcode='PZR04',message='Publication restriction conflict';end if;

  insert into app_publication_restriction.restrictions(kind,publication_id,restricted_revision,case_id,restricted_by)
   values(p_kind,p_publication,p_revision,p_case,p_actor) on conflict do nothing returning * into receipt;
  if not found then raise exception using errcode='PZR04',message='Publication restriction conflict';end if;
 end if;
 if session_expires<=clock_timestamp() or session_seen<=clock_timestamp()-interval '30 minutes' then
  raise exception using errcode='PZR01',message='Publication moderator required';
 end if;
 return jsonb_build_object('kind',receipt.kind,'publicationId',receipt.publication_id,'revision',receipt.restricted_revision::text,
  'caseId',receipt.case_id,'restrictedAt',to_char(receipt.restricted_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));
end;
$$;

revoke all on function app_publication_restriction.restrict(text,uuid,text,uuid,bigint,uuid) from public;
grant usage on schema app_publication_restriction to blizhniy_publication_operator;
grant execute on function app_publication_restriction.restrict(text,uuid,text,uuid,bigint,uuid) to blizhniy_publication_operator;
commit;
