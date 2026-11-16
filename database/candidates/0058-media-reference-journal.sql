-- Isolated candidate, deliberately outside active migrations. No installation,
-- grants or file deletion. Retirement accounting below is tested only in disposable PG.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '10s';

create function app.media_retention_clock() returns timestamptz language sql volatile
set search_path=pg_catalog,pg_temp as $$select pg_catalog.clock_timestamp()$$;
revoke all on function app.media_retention_clock() from public;

create table app.media_reference_events (
 event_id bigint generated always as identity primary key,
 media_id uuid not null references app.media_objects(id) on delete restrict,
 source text not null check(source in ('media_objects','listing_photos','work_publication_photos','service_publication_photos',
  'work_publications','service_publications','cabinet_profiles','listings','applications','booking_requests','payment_checkout_intents','payment_refund_requests')),
 resource_id uuid not null,
 event_type text not null check(event_type in ('reserved','ready','attached','detached','history','observed','observed_attached','observed_history')),
 recorded_at timestamptz not null default app.media_retention_clock() check(isfinite(recorded_at))
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

create table app.media_payment_reference_captures (
 intent_id uuid primary key references app.payment_checkout_intents(id) on delete restrict,
 capture_type text not null check(capture_type in ('exact','unresolved','legacy')),
 recorded_at timestamptz not null check(isfinite(recorded_at))
);
create table app.media_retirement_requests (
 media_id uuid primary key references app.media_objects(id) on delete restrict,
 operation_id uuid not null unique,
 requested_at timestamptz not null check(isfinite(requested_at)),
 unique(media_id,operation_id)
);
create table app.media_retirement_completions (
 media_id uuid primary key,
 operation_id uuid not null,
 completed_at timestamptz not null check(isfinite(completed_at)),
 foreign key(media_id,operation_id) references app.media_retirement_requests(media_id,operation_id) on delete restrict
);
revoke all on app.media_payment_reference_captures,app.media_retirement_requests,app.media_retirement_completions from public;
do $$declare table_name text;begin
 foreach table_name in array array['media_payment_reference_captures','media_retirement_requests','media_retirement_completions'] loop
  execute format('create trigger media_history_immutable before update or delete on app.%I for each row execute function app.guard_media_reference_events()',table_name);
  execute format('create trigger media_history_no_truncate before truncate on app.%I for each statement execute function app.guard_media_reference_events()',table_name);
 end loop;
end $$;

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
 if exists(select 1 from app.media_retirement_requests where media_id=any(new_ids)) then
  raise exception 'Media is terminally reserved' using errcode='MRJ02';
 end if;
 stamp:=app.media_retention_clock();
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

create function app.capture_payment_media(purchase_id uuid,legacy boolean) returns void
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare
 purchase app.payment_checkout_intents;target record;selected uuid[]:=array[]::uuid[];
 payload jsonb;exact boolean:=false;stamp timestamptz;
begin
 if exists(select 1 from app.media_payment_reference_captures where intent_id=purchase_id) then return;end if;
 if current_setting('transaction_isolation')<>'read committed' then raise exception 'Read committed required' using errcode='MRJ01';end if;
 select * into strict purchase from app.payment_checkout_intents where id=purchase_id;
 if not legacy then
  if purchase.target_type='listing' then
   select author_id,revision,booking into target from app.listings where id=purchase.target_id for no key update;
   exact:=found and target.author_id=purchase.owner_id and target.revision=purchase.target_revision;
   if exact then
    selected:=array(select media_id from app.listing_photos where listing_id=purchase.target_id);
    payload:=target.booking;
   end if;
  elsif purchase.target_type in ('vacancy','workRequest') then
   select author_id,revision,kind,form into target from app.work_publications where id=purchase.target_id for no key update;
   exact:=found and target.author_id=purchase.owner_id and target.revision=purchase.target_revision and target.kind=purchase.target_type;
   if exact then selected:=array(select media_id from app.work_publication_photos where publication_id=purchase.target_id);payload:=target.form;end if;
  elsif purchase.target_type in ('specialist','fair_application','ad_marquee') then
   select author_id,revision,kind,form into target from app.service_publications where id=purchase.target_id for no key update;
   exact:=found and target.author_id=purchase.owner_id and target.revision=purchase.target_revision and
    target.kind=case purchase.target_type when 'fair_application' then 'fair' when 'ad_marquee' then 'marquee' else 'specialist' end;
   if exact then selected:=array(select media_id from app.service_publication_photos where publication_id=purchase.target_id);payload:=target.form;end if;
  elsif purchase.target_type='application' then
   select applicant_id,revision,snapshot into target from app.applications where id=purchase.target_id for no key update;
   exact:=found and target.applicant_id=purchase.owner_id and target.revision=purchase.target_revision;
   if exact then payload:=target.snapshot;end if;
  end if;
 end if;
 if exact then
  selected:=selected||app.media_reference_ids(payload)||app.media_reference_ids(purchase.request_body::jsonb);
 else
  -- Unknown old versions must retain the actual observed set, not inferred current photos.
  select array_agg(id order by id) into selected from (select id from app.media_objects order by id limit 10001) bounded;
  selected:=coalesce(selected,array[]::uuid[]);
 end if;
 selected:=array(select id from app.media_objects where id=any(selected) order by id limit 10001);
 if cardinality(selected)>10000 then raise exception 'Media capture bound exceeded' using errcode='MRJ03';end if;
 perform id from app.media_objects where id=any(selected) order by id for no key update;
 -- A separate statement sees a retirement committed while we waited for its media lock.
 if exists(select 1 from app.media_retirement_requests where media_id=any(selected)) then
  raise exception 'Media capture requires retained files' using errcode='MRJ02';
 end if;
 stamp:=app.media_retention_clock();
 insert into app.media_payment_reference_captures(intent_id,capture_type,recorded_at)
  values(purchase_id,case when legacy then 'legacy' when exact then 'exact' else 'unresolved' end,stamp);
 insert into app.media_reference_events(media_id,source,resource_id,event_type,recorded_at)
  select id,'payment_checkout_intents',purchase_id,'history',stamp from app.media_objects where id=any(selected) order by id;
end $$;
revoke all on function app.capture_payment_media(uuid,boolean) from public;
create function app.journal_payment_media() returns trigger language plpgsql security definer
set search_path=pg_catalog,pg_temp as $$begin perform app.capture_payment_media(new.id,false);return new;end $$;
revoke all on function app.journal_payment_media() from public;
-- Target first, media second; this must precede the literal-UUID journal trigger.
create trigger zz_media_payment_capture after insert on app.payment_checkout_intents
for each row execute function app.journal_payment_media();

create function app.guard_media_retirement_request() returns trigger
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare latest timestamptz;stamp timestamptz;operation uuid;
begin
 if current_setting('transaction_isolation')<>'read committed' then raise exception 'Read committed required' using errcode='MRJ01';end if;
 perform id from app.media_objects where id=new.media_id for no key update;
 if not found then raise exception 'Media unavailable' using errcode='MRJ02';end if;
 select operation_id into operation from app.media_retirement_requests where media_id=new.media_id;
 if found then
  if operation<>new.operation_id then raise exception 'Retirement operation conflict' using errcode='MRJ02';end if;
  select requested_at into new.requested_at from app.media_retirement_requests where media_id=new.media_id;return new;
 end if;
 if exists(select 1 from app.media_reference_events where media_id=new.media_id and event_type in ('history','observed_history')) or
  exists(select 1 from (select distinct on(source,resource_id) event_type from app.media_reference_events
   where media_id=new.media_id and event_type in ('attached','detached','observed_attached') order by source,resource_id,event_id desc) current_refs where event_type<>'detached') then
  raise exception 'Media remains referenced' using errcode='MRJ02';
 end if;
 select max(recorded_at) into latest from app.media_reference_events where media_id=new.media_id;
 stamp:=app.media_retention_clock();
 if latest is null or not isfinite(stamp) or latest>stamp-interval '168 hours' then
  raise exception 'Media retention has not elapsed' using errcode='MRJ02';
 end if;
 new.requested_at:=stamp;return new;
end $$;
revoke all on function app.guard_media_retirement_request() from public;
create trigger media_retirement_request_guard before insert on app.media_retirement_requests
for each row execute function app.guard_media_retirement_request();

create function app.guard_media_retirement_completion() returns trigger
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare request app.media_retirement_requests;existing app.media_retirement_completions;
begin
 if current_setting('transaction_isolation')<>'read committed' then raise exception 'Read committed required' using errcode='MRJ01';end if;
 perform id from app.media_objects where id=new.media_id for no key update;
 select * into request from app.media_retirement_requests where media_id=new.media_id;
 if not found or request.operation_id<>new.operation_id then raise exception 'Retirement operation required' using errcode='MRJ02';end if;
 select * into existing from app.media_retirement_completions where media_id=new.media_id;
 if found then new.completed_at:=existing.completed_at;return new;end if;
 new.completed_at:=app.media_retention_clock();
 if not isfinite(new.completed_at) or new.completed_at<request.requested_at then raise exception 'Retirement clock unavailable' using errcode='MRJ02';end if;
 return new;
end $$;
revoke all on function app.guard_media_retirement_completion() from public;
create trigger media_retirement_completion_guard before insert on app.media_retirement_completions
for each row execute function app.guard_media_retirement_completion();

-- Only a future trusted filesystem worker may receive INSERT on completions.
-- PostgreSQL cannot prove unlink/fsync; no runtime role is granted this capability here.
create function app.release_completed_media_budget() returns trigger
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
begin
 update app.media_storage_budget b set charged_bytes=b.charged_bytes-m.size,charged_objects=b.charged_objects-1
  from app.media_objects m where b.singleton and m.id=new.media_id and b.charged_bytes>=m.size and b.charged_objects>=1;
 if not found then raise exception 'Media accounting unavailable' using errcode='MRJ03';end if;
 return new;
end $$;
revoke all on function app.release_completed_media_budget() from public;
create trigger media_retirement_release after insert on app.media_retirement_completions
for each row execute function app.release_completed_media_budget();
create view app.media_active_usage as
 select m.owner_id,sum(m.size)::bigint charged_bytes,count(*)::bigint charged_objects from app.media_objects m
 where not exists(select 1 from app.media_retirement_completions c where c.media_id=m.id) group by m.owner_id;
revoke all on app.media_active_usage from public;

create function app.guard_retired_media_write() returns trigger
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$begin
 if current_setting('transaction_isolation')<>'read committed' then raise exception 'Read committed required' using errcode='MRJ01';end if;
 perform id from app.media_objects where id=new.media_id for no key update;
 if exists(select 1 from app.media_retirement_requests where media_id=new.media_id) then raise exception 'Media is terminally reserved' using errcode='MRJ02';end if;
 return new;
end $$;
revoke all on function app.guard_retired_media_write() from public;
create trigger zz_media_retirement_write_guard after insert on app.media_write_attempts
for each row execute function app.guard_retired_media_write();

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
do $$declare purchase record;begin
 for purchase in select id from app.payment_checkout_intents order by id loop
  perform app.capture_payment_media(purchase.id,true);
 end loop;
end $$;
commit;
