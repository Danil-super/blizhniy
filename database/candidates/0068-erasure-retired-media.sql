-- Candidate for the isolated 0058/0063 fixture. Existing roles get no new privileges.
begin;
set local lock_timeout='3s';
set local statement_timeout='10s';

lock table app.media_retirement_completions,app_admin.basic_account_erasures in access share mode;
alter table app.media_objects alter column owner_id drop not null;
alter table app.media_objects drop constraint media_objects_owner_id_fkey;
alter table app.media_objects add constraint media_objects_owner_id_fkey
 foreign key(owner_id) references app.users(id) on delete set null;

create or replace function app.guard_media_record() returns trigger
language plpgsql set search_path=pg_catalog,pg_temp as $$
begin
 if tg_op='DELETE' then
  raise exception 'Media cleanup proof required' using errcode='BL003';
 elsif tg_op='INSERT' then
  if new.owner_id is null or new.state<>'pending' or new.ready_at is not null then
   raise exception 'Media must start pending with an owner' using errcode='23514';
  end if;
 else
  if row(new.id,new.intent_id,new.mime_type,new.width,new.height,new.size,new.sha256,new.created_at)
   is distinct from row(old.id,old.intent_id,old.mime_type,old.width,old.height,old.size,old.sha256,old.created_at)
   or (old.state='ready' and (new.state<>'ready' or new.ready_at is distinct from old.ready_at)) then
   raise exception 'Media identity and metadata are immutable' using errcode='23514';
  end if;
  if new.owner_id is distinct from old.owner_id and (
   old.owner_id is null or new.owner_id is not null
   or new.state<>old.state or new.ready_at is distinct from old.ready_at
   or exists(select 1 from app.users u where u.id=old.owner_id)
   or not exists(select 1 from app.media_retirement_completions c where c.media_id=old.id)
   or not exists(
    select 1 from app_admin.basic_account_erasures e
    join app.account_deletion_requests d on d.id=e.request_id
    where e.subject_id=old.owner_id and d.status='resolved' and d.resolution='partly_retained'
     and d.case_reference='B1_'||replace(e.operation_id::text,'-','')||'_'||e.expected_auth_version||'_'||e.expected_request_revision
     and (d.user_id is null or d.user_id=old.owner_id)
     and exists(select 1 from app.account_deletion_events a
      where a.request_id=d.id and a.status='requested' and a.actor_id=old.owner_id)
   )
  ) then
   raise exception 'Media owner erasure requires a completed retirement and an approved case' using errcode='BL003';
  end if;
 end if;
 return new;
end;
$$;
revoke all on function app.guard_media_record() from public;
commit;
