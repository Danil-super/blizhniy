begin;
set local lock_timeout='3s';
set local statement_timeout='10s';

do $$
begin
 if not exists(select 1 from pg_catalog.pg_trigger
  where tgrelid='app.notifications'::regclass and tgname='apply_inbox_preference'
   and tgfoid=to_regprocedure('app.apply_inbox_preference()') and tgenabled in ('O','A') and not tgisinternal) then
  raise exception 'Business email requires inbox preference trigger 0064';
 end if;
end $$;

create schema notification_delivery;
revoke all on schema notification_delivery from public;

create table notification_delivery.business_email(
 notification_id uuid primary key references app.notifications(id) on delete cascade,
 state text not null default 'ready' check(state in ('ready','sending','accepted','cancelled','failed','unknown')),
 queued_at timestamptz not null default clock_timestamp(),
 available_at timestamptz not null default clock_timestamp(),
 updated_at timestamptz not null default clock_timestamp(),
 attempts smallint not null default 0 check(attempts between 0 and 5),
 claim_id uuid,
 lease_until timestamptz,
 last_code text check(last_code in ('accepted','ineligible','expired','lost_worker','TEMPORARY','REJECTED','AUTH_FAILED','UNKNOWN')),
 check((state='sending')=(claim_id is not null) and (state='sending')=(lease_until is not null))
);
revoke all on table notification_delivery.business_email from public;
create index business_email_ready_idx on notification_delivery.business_email(available_at,notification_id) where state='ready';
create index business_email_expiry_idx on notification_delivery.business_email(queued_at,notification_id) where state='ready';
create index business_email_lease_idx on notification_delivery.business_email(lease_until,notification_id) where state='sending';

create function notification_delivery.business_email_recipient(event_id uuid) returns text
language sql stable set search_path=pg_catalog,pg_temp as $$
 select u.email from app.notifications n
 join app.users u on u.id=n.user_id and u.email_verified_at is not null and not u.is_blocked
 left join app.cabinet_profiles p on p.user_id=n.user_id
 where n.id=event_id and n.dismissed_at is null
  and p.profile->'emailNotifications' is distinct from 'false'::jsonb
  and p.profile->(case n.category
   when 'booking' then 'notifyBookings'
   when 'message' then 'notifyMessages'
   when 'payment' then 'notifyPayments'
   when 'publication' then 'notifyPublicationStatus'
   when 'system' then 'notifySystem'
  end) is distinct from 'false'::jsonb;
$$;

create function notification_delivery.enqueue_business_email() returns trigger
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
begin
 if notification_delivery.business_email_recipient(new.id) is not null then
  insert into notification_delivery.business_email(notification_id) values(new.id);
 end if;
 return null;
end $$;
create trigger enqueue_business_email after insert on app.notifications
 for each row when (new.dismissed_at is null) execute function notification_delivery.enqueue_business_email();

-- This commit is the authorization point. Once sending is committed, loss is ambiguous.
create function notification_delivery.claim_business_email(claim uuid) returns table(id uuid,recipient text)
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
begin
 if claim is null then raise exception 'Business email claim required';end if;
 select m.notification_id into id from notification_delivery.business_email m
 where m.state='ready' and m.attempts<5 and m.available_at<=statement_timestamp()
  and m.queued_at>statement_timestamp()-interval '24 hours'
 order by m.available_at,m.notification_id limit 1 for update skip locked;
 if not found then return;end if;
 recipient:=notification_delivery.business_email_recipient(id);
 if recipient is null then
  update notification_delivery.business_email set state='cancelled',last_code='ineligible',updated_at=clock_timestamp()
  where notification_id=id;
 else
  update notification_delivery.business_email set state='sending',attempts=attempts+1,claim_id=claim,
   lease_until=clock_timestamp()+interval '2 minutes',updated_at=clock_timestamp() where notification_id=id;
 end if;
 return next;
end $$;

create function notification_delivery.finish_business_email(event_id uuid,claim uuid,outcome text) returns text
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare result text;
begin
 if outcome is null or outcome not in ('accepted','TEMPORARY','REJECTED','AUTH_FAILED','UNKNOWN') then
  raise exception 'Invalid business email outcome';
 end if;
 update notification_delivery.business_email m set
  state=case when outcome='accepted' then 'accepted' when outcome='UNKNOWN' then 'unknown'
   when outcome='TEMPORARY' and m.attempts<5 then 'ready' else 'failed' end,
  available_at=case when outcome='TEMPORARY' and m.attempts<5
   then clock_timestamp()+(60*(1<<(m.attempts-1)))*interval '1 second' else m.available_at end,
  last_code=outcome,claim_id=null,lease_until=null,updated_at=clock_timestamp()
 where m.notification_id=event_id and m.claim_id=claim and m.state='sending'
 returning m.state into result;
 return result;
end $$;

create function notification_delivery.sweep_business_email() returns integer
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare lost integer; expired integer;
begin
 with stale as (
  select notification_id from notification_delivery.business_email where state='sending' and lease_until<=statement_timestamp()
  order by lease_until,notification_id limit 100 for update skip locked
 ) update notification_delivery.business_email m set state='unknown',last_code='lost_worker',
   claim_id=null,lease_until=null,updated_at=clock_timestamp()
   from stale s where m.notification_id=s.notification_id;
 get diagnostics lost=row_count;
 with stale as (
  select notification_id from notification_delivery.business_email where state='ready' and queued_at<=statement_timestamp()-interval '24 hours'
  order by queued_at,notification_id limit 100 for update skip locked
 ) update notification_delivery.business_email m set state='cancelled',last_code='expired',updated_at=clock_timestamp()
   from stale s where m.notification_id=s.notification_id;
 get diagnostics expired=row_count;
 return lost+expired;
end $$;

revoke all on function notification_delivery.business_email_recipient(uuid),notification_delivery.enqueue_business_email(),
 notification_delivery.claim_business_email(uuid),notification_delivery.finish_business_email(uuid,uuid,text),
 notification_delivery.sweep_business_email() from public;
commit;
