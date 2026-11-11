-- Local owner lifecycle; no financial write grants, period changes or destructive deletion.
begin;
set local lock_timeout='3s';set local statement_timeout='10s';
create table app.work_owner_actions (
 operation_id uuid primary key,
 publication_id uuid not null references app.work_publications(id) on delete restrict,
 owner_id uuid not null references app.users(id) on delete restrict,
 kind text not null check(kind in ('vacancy','workRequest')),
 expected_revision bigint not null check(expected_revision>=1),
 action text not null check(action in ('withdraw','restore','remove')),
 reason text,
 resulting_revision bigint not null check(resulting_revision=expected_revision+1),
 status text not null check(status in ('published','archived')),
 occurred_at timestamptz not null check(isfinite(occurred_at)),
 unique(publication_id,resulting_revision),
 check((action='restore' and reason is null) or (action<>'restore' and reason is not null and char_length(reason) between 1 and 500))
);
create index work_owner_actions_owner_idx on app.work_owner_actions(owner_id,publication_id,resulting_revision desc);
create index work_owner_closure_idx on app.work_owner_actions(publication_id,occurred_at) where action in ('withdraw','remove');
create function app.apply_work_owner_action() returns trigger
 language plpgsql security definer set search_path='' as $$
declare session_hash text;actor uuid;version bigint;target app.work_publications;initial app.work_publications;payment record;original uuid;matches integer:=0;latest text;next_status text;
begin
 if tg_op<>'INSERT' then raise exception 'Owner action history is immutable' using errcode='42501';end if;
 if pg_catalog.current_setting('transaction_isolation')<>'read committed' then raise exception 'Owner action requires read committed' using errcode='23514';end if;
 session_hash:=pg_catalog.current_setting('blizhniy.work_owner_session',true);
 if session_hash is null or session_hash !~ '^[a-f0-9]{64}$' then raise exception 'Owner session required' using errcode='42501';end if;
 select user_id into actor from app.sessions where token_hash=session_hash;
 select auth_version into version from app.users where id=actor and not is_blocked and email_verified_at is not null for update;
 if not found then raise exception 'Owner session required' using errcode='42501';end if;
 perform token_hash from app.sessions where token_hash=session_hash and user_id=actor and auth_version=version and scope='app'
  and expires_at>pg_catalog.clock_timestamp() and last_seen_at>pg_catalog.clock_timestamp()-interval '30 minutes' for update;
 if not found then raise exception 'Owner session required' using errcode='42501';end if;
 if new.action not in ('withdraw','restore','remove') or new.action is null or new.expected_revision is null or new.expected_revision not between 1 and 9223372036854775806 then
  raise exception 'Invalid owner action' using errcode='23514';end if;
 if new.action='restore' then
  if new.reason is not null then raise exception 'Invalid restore reason' using errcode='23514';end if;
 elsif new.reason is null or char_length(new.reason) not between 1 and 500 or
  new.reason<>pg_catalog.btrim(new.reason,U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF') or
  new.reason ~ '[[:cntrl:]]' or new.reason ~ U&'[\007F-\009F\061C\200E\200F\202A-\202E\2066-\2069]' or
  (select coalesce(sum(case when pg_catalog.ascii(ch)>65535 then 2 else 1 end),0) from pg_catalog.regexp_split_to_table(new.reason,'') ch)>500 or
  new.reason ~* '<[[:space:]]*(/?[a-z][^<>]*|![^<>]*|[?][^<>]*)>' then
  raise exception 'Owner closure reason required' using errcode='23514';
 end if;
 select * into initial from app.work_publications where id=new.publication_id and author_id=actor;
 if not found then raise exception 'Own publication required' using errcode='PWA01';end if;
 -- Actor is locked. Match financial writers before locking the target, never wait across owners.
 for payment in select i.id,o.status,f.published_at,f.expires_at from app.payment_checkout_intents i
  join app.payment_orders o on o.id=i.id left join app.payment_fulfillments f on f.intent_id=i.id
  where i.owner_id=actor and i.target_id=initial.id and i.target_type=initial.kind and
   (o.status in ('created','pending','succeeded') or (f.published_at=initial.published_at and f.expires_at=initial.expires_at))
  order by i.id limit 3 for update of i,o nowait loop
  if payment.status in ('created','pending') or (payment.status='succeeded' and payment.published_at is null) then
   raise exception 'Resolve publication checkout first' using errcode='PWA02';end if;
  if payment.published_at=initial.published_at and payment.expires_at=initial.expires_at and payment.status='succeeded' then original:=payment.id;matches:=matches+1;end if;
 end loop;
 select * into target from app.work_publications where id=initial.id and author_id=actor for update nowait;
 if not found or target.deleted_at is not null then raise exception 'Own publication required' using errcode='PWA01';end if;
 if target.revision<>new.expected_revision or target.published_at is distinct from initial.published_at or target.expires_at is distinct from initial.expires_at then
  raise exception 'Publication changed' using errcode='PWA02';end if;
 -- Delivery/checkout writers serialize on the same work row. Do not strand a paid response.
 if exists(select 1 from app.applications a join app.payment_orders o on o.target_type='application' and o.target_id=a.id
  where a.work_publication_id=target.id and (o.status in ('created','pending') or
   (o.status='succeeded' and (not a.is_paid or a.sent_at is null or a.status not in ('sent','viewed','selected','rejected'))))) then
  raise exception 'Resolve response checkout before changing visibility' using errcode='PWA03';end if;
 if new.action='withdraw' then
  if target.status<>'published' or not target.is_paid or target.published_at>pg_catalog.clock_timestamp() or target.expires_at<=pg_catalog.clock_timestamp() then
   raise exception 'Publication cannot be withdrawn' using errcode='PWA02';end if;
 elsif new.action='restore' then
  select action into latest from app.work_owner_actions where publication_id=target.id and owner_id=actor order by resulting_revision desc limit 1;
  if latest is distinct from 'withdraw' or target.status<>'archived' or not target.is_paid or matches<>1 or original is null or
   target.published_at is null or target.published_at>pg_catalog.clock_timestamp() or target.expires_at<=pg_catalog.clock_timestamp() or
   exists(select 1 from app.work_moderation m where m.publication_id=target.id and m.state='rejected' and m.revision>=(select target_revision from app.payment_checkout_intents where id=original)) or
   (target.kind='workRequest' and exists(select 1 from app.applications a where a.work_publication_id=target.id and a.status='selected' and a.is_paid and a.sent_at is not null)) then
   raise exception 'Current paid placement required to restore' using errcode='PWA02';end if;
  perform id from app.cities where id=target.city_id and name=target.form->>'cityName' for share nowait;
  if not found then raise exception 'Current city required' using errcode='PWA02';end if;
  perform id from app.specialist_categories where id=target.profession_id and active and
   (not(target.form ? 'professionId') or target.form->>'professionId'=id::text) for share nowait;
  if not found then raise exception 'Current profession required' using errcode='PWA02';end if;
  if exists(select 1 from app.work_publication_photos p join app.media_objects m on m.id=p.media_id where p.publication_id=target.id and (m.owner_id<>actor or m.state<>'ready')) then
   raise exception 'Current photos required' using errcode='PWA02';end if;
 end if;
 -- The financial/reference locks above never authorize an expired browser session.
 perform token_hash from app.sessions where token_hash=session_hash and user_id=actor and auth_version=version and scope='app'
  and expires_at>pg_catalog.clock_timestamp() and last_seen_at>pg_catalog.clock_timestamp()-interval '30 minutes';
 if not found then raise exception 'Owner session expired' using errcode='42501';end if;
 next_status:=case when new.action='restore' then 'published' else 'archived' end;
 new.owner_id:=actor;new.kind:=target.kind;new.resulting_revision:=new.expected_revision+1;new.status:=next_status;new.occurred_at:=pg_catalog.clock_timestamp();return new;
end $$;
-- BEFORE INSERT also runs for rows discarded by ON CONFLICT. Mutate only after
-- a successful journal INSERT, while all validated session/resource locks remain held.
create function app.apply_work_owner_action_effect() returns trigger
 language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from app.sessions s join app.users u on u.id=s.user_id
  where s.token_hash=pg_catalog.current_setting('blizhniy.work_owner_session',true) and s.user_id=new.owner_id and s.auth_version=u.auth_version
   and s.scope='app' and not u.is_blocked and u.email_verified_at is not null
   and s.expires_at>pg_catalog.clock_timestamp() and s.last_seen_at>pg_catalog.clock_timestamp()-interval '30 minutes') then
  raise exception 'Owner session expired' using errcode='42501';end if;
 update app.work_publications set status=new.status,revision=revision+1,updated_at=pg_catalog.clock_timestamp(),
  deleted_at=case when new.action='remove' then pg_catalog.clock_timestamp() else deleted_at end
  where id=new.publication_id and author_id=new.owner_id and revision=new.expected_revision and deleted_at is null;
 if not found then raise exception 'Publication changed' using errcode='PWA02';end if;
 return new;
end $$;
create trigger work_owner_action_guard before insert or update or delete on app.work_owner_actions for each row execute function app.apply_work_owner_action();
create trigger work_owner_action_truncate_guard before truncate on app.work_owner_actions for each statement execute function app.apply_work_owner_action();
create trigger work_owner_action_effect after insert on app.work_owner_actions for each row execute function app.apply_work_owner_action_effect();
alter table app.work_owner_actions enable always trigger work_owner_action_guard;
alter table app.work_owner_actions enable always trigger work_owner_action_truncate_guard;
alter table app.work_owner_actions enable always trigger work_owner_action_effect;
revoke all on app.work_owner_actions from public;
revoke all on function app.apply_work_owner_action(),app.apply_work_owner_action_effect() from public;
commit;
