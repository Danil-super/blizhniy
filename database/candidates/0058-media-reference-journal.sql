-- Isolated candidate, deliberately outside active migrations. No installation,
-- grants, retirement, file deletion or quota release. Existing media stays immutable.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '10s';

create table app.media_reference_events (
 event_id bigint generated always as identity primary key,
 media_id uuid not null references app.media_objects(id) on delete restrict,
 source text not null check(source in ('media_objects','listing_photos','work_publication_photos','service_publication_photos',
  'work_publications','service_publications','cabinet_profiles','listings','applications','booking_requests','payment_checkout_intents','payment_refund_requests')),
 resource_id uuid not null,
 event_type text not null check(event_type in ('reserved','ready','attached','detached','history','observed','observed_attached','observed_history')),
 recorded_at timestamptz not null default clock_timestamp() check(isfinite(recorded_at))
);
create index media_reference_events_media_idx on app.media_reference_events(media_id,event_id);
revoke all on app.media_reference_events from public;
revoke all on sequence app.media_reference_events_event_id_seq from public;

create function app.guard_media_reference_events() returns trigger
language plpgsql set search_path=pg_catalog,pg_temp as $$
begin
 raise exception 'Media reference history is immutable' using errcode='23514';
end $$;
create trigger media_reference_events_immutable before update or delete on app.media_reference_events
for each row execute function app.guard_media_reference_events();
create trigger media_reference_events_no_truncate before truncate on app.media_reference_events
for each statement execute function app.guard_media_reference_events();
revoke all on function app.guard_media_reference_events() from public;

-- Normalize JSON escapes before extracting literal UUID observations. Matching
-- an existing media identity is conservative evidence, never permission to delete.
create function app.media_reference_ids(payload jsonb) returns uuid[]
language sql immutable set search_path=pg_catalog,pg_temp as $$
 select coalesce(array_agg(distinct lower(found.hit[1])::uuid order by lower(found.hit[1])::uuid),array[]::uuid[])
 from regexp_matches(payload::text,'[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}','gi') found(hit)
$$;
revoke all on function app.media_reference_ids(jsonb) from public;

create function app.journal_media_reference_change() returns trigger
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare
 previous jsonb; replacement jsonb;
 old_ids uuid[]:=array[]::uuid[];new_ids uuid[]:=array[]::uuid[];
 previous_id uuid;replacement_id uuid;stamp timestamptz;
 mode text:=tg_argv[2];
begin
 if tg_nargs<>3 or mode not in ('photo','current','history','media') then
  raise exception 'Unsupported media reference source' using errcode='23514';
 end if;
 previous:=case when tg_op='INSERT' then '{}'::jsonb else to_jsonb(old) end;
 replacement:=case when tg_op='DELETE' then '{}'::jsonb else to_jsonb(new) end;
 previous_id:=(previous->>tg_argv[0])::uuid;replacement_id:=(replacement->>tg_argv[0])::uuid;
 if mode='media' then
  if tg_op='UPDATE' and (replacement->>'state') is not distinct from (previous->>'state') then return new;end if;
  new_ids:=array[replacement_id];
 elsif mode='photo' then
  old_ids:=array_remove(array[(previous->>tg_argv[1])::uuid],null);
  new_ids:=array_remove(array[(replacement->>tg_argv[1])::uuid],null);
 else
  if tg_argv[1]='request_body' then
   old_ids:=app.media_reference_ids((previous->>tg_argv[1])::jsonb);
   new_ids:=app.media_reference_ids((replacement->>tg_argv[1])::jsonb);
  else
   old_ids:=app.media_reference_ids(previous->tg_argv[1]);
   new_ids:=app.media_reference_ids(replacement->tg_argv[1]);
  end if;
 end if;
 if mode<>'media' and old_ids=new_ids and previous_id is not distinct from replacement_id then
  if tg_op='DELETE' then return old;end if;return new;
 end if;
 if current_setting('transaction_isolation')<>'read committed' then
  raise exception 'Media reference changes require read committed' using errcode='MRJ01';
 end if;
 -- Shared identity order for future retirement. The timestamp is taken AFTER
 -- waiting, so an old transaction cannot backdate the seven-day observation.
 perform m.id from app.media_objects m where m.id=any(old_ids||new_ids) order by m.id for no key update;
 stamp:=clock_timestamp();
 if mode='media' then
  insert into app.media_reference_events(media_id,source,resource_id,event_type,recorded_at)
   values(replacement_id,tg_table_name,replacement_id,case when tg_op='INSERT' then 'reserved' else 'ready' end,stamp);
 else
  if mode<>'history' then
   insert into app.media_reference_events(media_id,source,resource_id,event_type,recorded_at)
    select m.id,tg_table_name,previous_id,'detached',stamp from app.media_objects m
    where m.id=any(old_ids) and (not m.id=any(new_ids) or previous_id is distinct from replacement_id) order by m.id;
  end if;
  insert into app.media_reference_events(media_id,source,resource_id,event_type,recorded_at)
   select m.id,tg_table_name,replacement_id,case when mode='history' then 'history' else 'attached' end,stamp
   from app.media_objects m where m.id=any(new_ids)
    and (not m.id=any(old_ids) or previous_id is distinct from replacement_id) order by m.id;
 end if;
 if tg_op='DELETE' then return old;end if;
 return new;
end $$;
revoke all on function app.journal_media_reference_change() from public;

create trigger zz_media_reference_journal after insert or update of state on app.media_objects
for each row execute function app.journal_media_reference_change('id','state','media');
do $$
declare binding record;
begin
 for binding in select * from (values
  ('listing_photos','listing_id','media_id','photo'),
  ('work_publication_photos','publication_id','media_id','photo'),
  ('service_publication_photos','publication_id','media_id','photo'),
  ('work_publications','id','form','current'),
  ('service_publications','id','form','current'),
  ('cabinet_profiles','user_id','profile','current'),
  ('listings','id','booking','current'),
  ('applications','id','snapshot','history'),
  ('booking_requests','id','details_snapshot','history'),
  ('payment_checkout_intents','id','request_body','history'),
  ('payment_refund_requests','operation_id','request_body','history')
 ) as bindings(table_name,identity_column,payload_column,mode) loop
  execute format('create trigger zz_media_reference_journal after insert or update or delete on app.%I for each row execute function app.journal_media_reference_change(%L,%L,%L)',
   binding.table_name,binding.identity_column,binding.payload_column,binding.mode);
 end loop;
end $$;

-- CREATE TRIGGER locks all sources until commit. Legacy history has no unlink
-- clock: record only a new observation after those locks, never created_at.
insert into app.media_reference_events(media_id,source,resource_id,event_type)
 select id,'media_objects',id,'observed' from app.media_objects order by id;
with refs as (
 select media_id,'listing_photos' source,listing_id resource_id from app.listing_photos
 union all select media_id,'work_publication_photos',publication_id from app.work_publication_photos
 union all select media_id,'service_publication_photos',publication_id from app.service_publication_photos
), documents as (
 select 'work_publications' source,id resource_id,form payload,false historical from app.work_publications
 union all select 'service_publications',id,form,false from app.service_publications
 union all select 'cabinet_profiles',user_id,profile,false from app.cabinet_profiles
 union all select 'listings',id,booking,false from app.listings where booking is not null
 union all select 'applications',id,snapshot,true from app.applications
 union all select 'booking_requests',id,details_snapshot,true from app.booking_requests
 union all select 'payment_checkout_intents',id,request_body::jsonb,true from app.payment_checkout_intents
 union all select 'payment_refund_requests',operation_id,request_body::jsonb,true from app.payment_refund_requests
), observations as (
 select media_id,source,resource_id,'observed_attached' event_type from refs
 union all select media_id,source,resource_id,case when historical then 'observed_history' else 'observed_attached' end
  from documents cross join lateral unnest(app.media_reference_ids(payload)) media(media_id)
)
insert into app.media_reference_events(media_id,source,resource_id,event_type)
 select m.id,o.source,o.resource_id,o.event_type from observations o join app.media_objects m on m.id=o.media_id
 order by m.id,o.source,o.resource_id;
commit;
