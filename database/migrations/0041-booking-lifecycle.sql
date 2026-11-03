-- Local opt-in. No production installer or changes to historical migrations.
begin;
set local lock_timeout='3s';
set local statement_timeout='10s';
lock table app.booking_requests in access exclusive mode;

create function app.booking_start_time(kind text,day date,terms jsonb) returns timestamptz
 language plpgsql immutable set search_path='' as $$
declare at_time text;
begin
 if kind not in ('stay','tour') or day is null or not pg_catalog.isfinite(day) then
  raise exception 'Invalid booking start' using errcode='23514';
 end if;
 at_time:=coalesce(terms->'booking'->>(case when kind='stay' then 'checkInTime' else 'tourTime' end),'00:00');
 if at_time !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
  raise exception 'Invalid booking start time' using errcode='23514';
 end if;
 return (day+at_time::time) at time zone 'Europe/Moscow';
end;
$$;
alter table app.booking_requests add column host_id uuid references app.users(id) on delete cascade,
 add column starts_at timestamptz,add column expires_at timestamptz,
 add column cancelled_by uuid references app.users(id),add column cancellation_reason text;
update app.booking_requests b set host_id=l.author_id,
 starts_at=app.booking_start_time(b.mode,b.start_date,b.details_snapshot),
 expires_at=least(b.created_at+interval '6 hours',app.booking_start_time(b.mode,b.start_date,b.details_snapshot))
 from app.listings l where l.id=b.listing_id;
alter table app.booking_requests alter column host_id set not null,
 alter column starts_at set not null,alter column expires_at set not null;
alter table app.booking_requests drop constraint booking_requests_status_check,drop constraint booking_decision;
alter table app.booking_requests add constraint booking_requests_status_check check(status in ('pending','accepted','declined','cancelled','expired')),
 add constraint booking_decision check((status='pending' and decided_at is null) or
  (status in ('accepted','declined','cancelled','expired') and decided_at is not null and decided_at>=created_at)),
 add constraint booking_deadline check(isfinite(starts_at) and isfinite(expires_at) and expires_at<=starts_at and expires_at<=created_at+interval '6 hours'),
 add constraint booking_cancellation check((status='cancelled' and cancelled_by is not null and cancelled_by in (host_id,guest_id)
  and cancellation_reason is not null and cancellation_reason=btrim(cancellation_reason) and char_length(cancellation_reason) between 1 and 500)
  or (status<>'cancelled' and cancelled_by is null and cancellation_reason is null));
create index booking_expiry_idx on app.booking_requests(expires_at,listing_id,id) where status='pending';
create index booking_pending_guest_idx on app.booking_requests(guest_id,expires_at) where status='pending';
create index booking_host_idx on app.booking_requests(host_id,created_at desc,id desc);
create table app.booking_events (
 booking_id uuid not null references app.booking_requests(id) on delete cascade,
 revision bigint not null check(revision>=1),
 status text not null check(status in ('pending','accepted','declined','cancelled','expired')),
 actor_id uuid,
 reason text,
 origin text not null check(origin in ('migration','operation')),
 created_at timestamptz not null default clock_timestamp(),
 primary key(booking_id,revision)
);
-- Preserve what is actually known. Do not invent historical decision actors.
insert into app.booking_events(booking_id,revision,status,origin)
 select id,revision,status,'migration' from app.booking_requests;
create function app.guard_booking_event() returns trigger language plpgsql set search_path='' as $$
begin
 if tg_op='DELETE' and current_user<>'blizhniy_runtime' and session_user<>'blizhniy_runtime' then return old;end if;
 raise exception 'Booking history is immutable' using errcode='42501';
end;
$$;
create trigger booking_event_immutable before update or delete on app.booking_events
 for each row execute function app.guard_booking_event();
alter table app.booking_events enable always trigger booking_event_immutable;

-- The actor setting is trusted server context, not an authorization boundary
-- against a compromised runtime role. withAppSessionTransaction owns auth locks.
create function app.guard_booking_lifecycle() returns trigger language plpgsql security definer set search_path='' as $$
declare actor uuid; host uuid; start_at timestamptz; wall timestamptz; count_holds integer;
begin
 if tg_op='DELETE' then
  if current_user='blizhniy_runtime' or session_user='blizhniy_runtime' then
   raise exception 'Booking cannot be erased by runtime' using errcode='42501';
  end if;
  return old;
 end if;
 -- Lock the guest before a listing even for a direct runtime INSERT. Different
 -- listing IDs must not race around the per-guest pending-hold limit.
 if tg_op='INSERT' then
  actor:=nullif(pg_catalog.current_setting('blizhniy.booking_actor',true),'')::uuid;
  perform id from app.users where id=actor and id=new.guest_id and not is_blocked and email_verified_at is not null for update;
  if not found then raise exception 'Booking actor required' using errcode='42501';end if;
 end if;
 -- The same listing lock is required for creates, decisions, cancellations and expiry.
 select author_id into host from app.listings where id=new.listing_id for update;
 if not found then raise exception 'Booking listing missing' using errcode='23514';end if;
 wall:=pg_catalog.clock_timestamp();
 if tg_op='UPDATE' and new.status='expired' then
  if old.status<>'pending' or old.expires_at>wall then
   raise exception 'Booking is not due' using errcode='PBO01';
  end if;
  actor:=null;
 else
  actor:=nullif(pg_catalog.current_setting('blizhniy.booking_actor',true),'')::uuid;
  if actor is null or not exists(select 1 from app.users where id=actor and not is_blocked and email_verified_at is not null) then
   raise exception 'Booking actor required' using errcode='42501';
  end if;
 end if;
 if tg_op='INSERT' then
  if actor<>new.guest_id or host=new.guest_id or new.status<>'pending' or new.revision<>1 or new.decided_at is not null then
   raise exception 'Invalid new booking' using errcode='42501';
  end if;
  -- The guest row is held across this count and insert, including across listings.
  select count(*) into count_holds from app.booking_requests where guest_id=actor and status='pending' and expires_at>wall;
  if count_holds>=3 then raise exception 'Too many pending holds' using errcode='PBO02';end if;
  start_at:=app.booking_start_time(new.mode,new.start_date,new.details_snapshot);
  if start_at<=wall then raise exception 'Booking already started' using errcode='PBO01';end if;
  new.host_id:=host;new.starts_at:=start_at;new.created_at:=wall;new.updated_at:=wall;
  new.expires_at:=least(wall+interval '6 hours',start_at);new.cancelled_by:=null;new.cancellation_reason:=null;
 else
  if (pg_catalog.to_jsonb(new)-array['status','revision','updated_at','decided_at','cancelled_by','cancellation_reason'])
    is distinct from (pg_catalog.to_jsonb(old)-array['status','revision','updated_at','decided_at','cancelled_by','cancellation_reason'])
    or old.revision=9223372036854775807 or new.revision<>old.revision+1 then
   raise exception 'Booking identity, quote and deadline are immutable' using errcode='42501';
  end if;
  if new.status='cancelled' then
   if old.status not in ('pending','accepted') or old.starts_at<=wall or (old.status='pending' and old.expires_at<=wall)
     or actor not in (old.guest_id,old.host_id) or new.cancelled_by is distinct from actor then
    raise exception 'Cancellation not allowed' using errcode='PBO01';
   end if;
   if new.cancellation_reason is null or new.cancellation_reason<>pg_catalog.btrim(new.cancellation_reason)
     or pg_catalog.char_length(new.cancellation_reason) not between 1 and 500
     or new.cancellation_reason ~ '[[:cntrl:]]' or new.cancellation_reason ~* '<[[:space:]]*(/?[a-z][^<>]*|![^<>]*|[?][^<>]*)>' then
    raise exception 'Invalid cancellation reason' using errcode='PBO03';
   end if;
  elsif new.status in ('accepted','declined') then
   if old.status<>'pending' or old.expires_at<=wall or actor is distinct from old.host_id then
    raise exception 'Decision not allowed' using errcode='PBO01';
   end if;
  elsif new.status<>'expired' then
   raise exception 'Terminal booking cannot change' using errcode='PBO01';
  end if;
  new.updated_at:=wall;new.decided_at:=wall;
 end if;
 return new;
end;
$$;
create trigger booking_lifecycle_guard before insert or update or delete on app.booking_requests
 for each row execute function app.guard_booking_lifecycle();
alter table app.booking_requests enable always trigger booking_lifecycle_guard;

create function app.record_booking_lifecycle() returns trigger language plpgsql security definer set search_path='' as $$
declare actor uuid;
begin
 actor:=case when new.status='expired' then null else nullif(pg_catalog.current_setting('blizhniy.booking_actor',true),'')::uuid end;
 -- FK checks below must never wait for another participant's auth/user lock
 -- while this transaction owns the listing. Fail promptly and retry/read back.
 if new.status in ('cancelled','expired') then
  perform id from app.users where id in (new.guest_id,new.host_id) order by id for key share nowait;
 end if;
 insert into app.booking_events(booking_id,revision,status,actor_id,reason,origin)
  values(new.id,new.revision,new.status,actor,new.cancellation_reason,'operation');
 if new.status='cancelled' then
  insert into app.notifications(user_id,event_key,category,tone,title,body,action_href,booking_request_id)
   values(case when new.cancelled_by=new.guest_id then new.host_id else new.guest_id end,
    'booking_cancelled:'||new.id::text,'booking','warning','Бронирование отменено',
    'Причина отмены: '||new.cancellation_reason,'/cabinet/bronirovaniya',new.id);
 elsif new.status='expired' then
  insert into app.notifications(user_id,event_key,category,tone,title,body,action_href,booking_request_id)
   select person,'booking_expired:'||new.id::text,'booking','warning','Срок ожидания бронирования истёк',
    'Ответ не получен вовремя. Даты освобождены.','/cabinet/bronirovaniya',new.id
    from unnest(array[new.guest_id,new.host_id]) as person;
 end if;
 return new;
end;
$$;
create trigger booking_lifecycle_event after insert or update on app.booking_requests
 for each row execute function app.record_booking_lifecycle();
alter table app.booking_requests enable always trigger booking_lifecycle_event;
revoke all on app.booking_events from public;
revoke all on function app.booking_start_time(text,date,jsonb),app.guard_booking_event(),app.guard_booking_lifecycle(),app.record_booking_lifecycle() from public;
commit;
