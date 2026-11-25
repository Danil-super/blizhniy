begin;
set local lock_timeout='3s';
set local statement_timeout='10s';

do $$
begin
 if not exists(select 1 from pg_catalog.pg_trigger
  where tgrelid='app.notifications'::regclass and tgname='apply_inbox_preference'
   and tgfoid=to_regprocedure('app.apply_inbox_preference()') and tgenabled in ('O','A') and not tgisinternal) then
  raise exception 'Push delivery requires inbox preference trigger 0064';
 end if;
end $$;

create table app_push.deliveries(
 id uuid primary key default gen_random_uuid(),
 notification_id uuid not null references app.notifications(id) on delete cascade,
 -- Keep outcome metadata when consent is removed or the provider invalidates a subscription.
 target_id uuid not null,
 unique(notification_id,target_id),
 state text not null default 'ready' check(state in ('ready','sending','accepted','cancelled','failed','unknown')),
 expires_at timestamptz not null default clock_timestamp()+interval '10 minutes',
 available_at timestamptz not null default clock_timestamp(),
 updated_at timestamptz not null default clock_timestamp(),
 attempts smallint not null default 0 check(attempts between 0 and 5),
 claim_id uuid,
 lease_until timestamptz,
 last_code text check(last_code in ('accepted','ineligible','expired','lost_worker','retry','gone','rejected','unknown')),
 check((state='sending')=(claim_id is not null) and (state='sending')=(lease_until is not null))
);
revoke all on app_push.deliveries from public;
create index push_delivery_ready_idx on app_push.deliveries(available_at,id) where state='ready';
create index push_delivery_expiry_idx on app_push.deliveries(expires_at,id) where state='ready';
create index push_delivery_lease_idx on app_push.deliveries(lease_until,id) where state='sending';

create function app_push.delivery_allowed(event_id uuid,target uuid) returns boolean
language sql stable set search_path=pg_catalog,pg_temp as $$
 select exists(
  select 1 from app.notifications n join app_push.subscriptions d on d.id=target
  join app.cabinet_profiles p on p.user_id=n.user_id
  where n.id=event_id and n.dismissed_at is null
   and (d.expires_at is null or d.expires_at>clock_timestamp())
   and app_push.current_owner(d.session_hash)=n.user_id
   and p.profile->'pushNotifications'='true'::jsonb
   and p.profile->(case n.category
    when 'booking' then 'notifyBookings'
    when 'message' then 'notifyMessages'
    when 'payment' then 'notifyPayments'
    when 'publication' then 'notifyPublicationStatus'
    when 'system' then 'notifySystem'
   end) is distinct from 'false'::jsonb
 );
$$;

create function app_push.enqueue_delivery() returns trigger
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
begin
 insert into app_push.deliveries(notification_id,target_id)
 select new.id,d.id from app.sessions s join app_push.subscriptions d on d.session_hash=s.token_hash
 where s.user_id=new.user_id and app_push.delivery_allowed(new.id,d.id)
 on conflict(notification_id,target_id) do nothing;
 return null;
end $$;
create trigger enqueue_push_delivery after insert on app.notifications
 for each row when(new.dismissed_at is null) execute function app_push.enqueue_delivery();

-- The wire id now names one delivery. The signature and web role grant from 0086 stay in place.
create or replace function app_push.may_display(session_key text,subscription_id uuid) returns boolean
language sql stable security definer set search_path=pg_catalog,pg_temp as $$
 select exists(
  select 1 from app_push.deliveries job join app_push.subscriptions d on d.id=job.target_id
   where job.id=$2 and d.session_hash=session_key and job.state in ('sending','accepted','unknown')
    and job.expires_at>clock_timestamp() and app_push.delivery_allowed(job.notification_id,d.id)
 );
$$;

create function app_push.claim_delivery(claim uuid) returns table(id uuid,endpoint text,p256dh text,auth text,ttl integer)
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare job app_push.deliveries%rowtype;
begin
 if claim is null then raise exception 'Push delivery claim required';end if;
 select * into job from app_push.deliveries j
 where j.state='ready' and j.attempts<5 and j.available_at<=statement_timestamp()
  and j.expires_at>statement_timestamp()
 order by j.available_at,j.id limit 1 for update skip locked;
 if not found then return;end if;
 id:=job.id;
 if job.expires_at>clock_timestamp() and app_push.delivery_allowed(job.notification_id,job.target_id) then
  select d.endpoint,d.p256dh,d.auth,greatest(1,floor(extract(epoch from
   least(job.expires_at,d.expires_at,s.expires_at)-clock_timestamp()))::integer)
  into endpoint,p256dh,auth,ttl from app_push.subscriptions d join app.sessions s on s.token_hash=d.session_hash
  where d.id=job.target_id;
 end if;
 if endpoint is null then
  update app_push.deliveries j set state='cancelled',last_code='ineligible',updated_at=clock_timestamp() where j.id=job.id;
 else
  update app_push.deliveries j set state='sending',attempts=attempts+1,claim_id=claim,
   lease_until=clock_timestamp()+interval '1 minute',updated_at=clock_timestamp() where j.id=job.id;
 end if;
 return next;
end $$;

create function app_push.finish_delivery(delivery_id uuid,claim uuid,outcome text,delay_seconds integer) returns text
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare result text; target uuid;
begin
 if outcome is null or outcome not in ('accepted','retry','gone','rejected','unknown')
   or delay_seconds is null or delay_seconds not between 0 and 86400
   or (outcome='retry' and delay_seconds=0) or (outcome<>'retry' and delay_seconds<>0) then
  raise exception 'Invalid push delivery outcome';
 end if;
 update app_push.deliveries j set
  state=case when outcome='accepted' then 'accepted' when outcome='unknown' then 'unknown'
   when outcome='retry' and j.attempts<5 and clock_timestamp()+delay_seconds*interval '1 second'<j.expires_at
    then 'ready' else 'failed' end,
  available_at=case when outcome='retry' then clock_timestamp()+delay_seconds*interval '1 second' else j.available_at end,
  last_code=outcome,claim_id=null,lease_until=null,updated_at=clock_timestamp()
 where j.id=delivery_id and j.claim_id=claim and j.state='sending'
 returning j.state,j.target_id into result,target;
 if result is not null and outcome='gone' then delete from app_push.subscriptions where id=target;end if;
 return result;
end $$;

create function app_push.sweep_delivery() returns integer
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare lost integer; expired integer;
begin
 with stale as (
  select id from app_push.deliveries where state='sending' and lease_until<=statement_timestamp()
  order by lease_until,id limit 100 for update skip locked
 ) update app_push.deliveries j set state='unknown',last_code='lost_worker',
   claim_id=null,lease_until=null,updated_at=clock_timestamp() from stale s where j.id=s.id;
 get diagnostics lost=row_count;
 with stale as (
  select id from app_push.deliveries where state='ready' and expires_at<=statement_timestamp()
  order by expires_at,id limit 100 for update skip locked
 ) update app_push.deliveries j set state='cancelled',last_code='expired',
   updated_at=clock_timestamp() from stale s where j.id=s.id;
 get diagnostics expired=row_count;
 return lost+expired;
end $$;

revoke all on function app_push.delivery_allowed(uuid,uuid),app_push.enqueue_delivery(),app_push.claim_delivery(uuid),
 app_push.finish_delivery(uuid,uuid,text,integer),app_push.sweep_delivery() from public;
commit;
