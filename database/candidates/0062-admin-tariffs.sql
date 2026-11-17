-- Candidate only: independent admin journal; existing app schema/financial grants stay unchanged.
begin;
set local lock_timeout='3s';
set local statement_timeout='10s';
alter table app_admin.migrations drop constraint migrations_name_check,
 add constraint migrations_name_check check(name in ('0061-admin-user-access.sql','0062-admin-tariffs.sql'));
create table app_admin.tariff_changes(
 id uuid primary key,
 sequence bigserial not null unique check(sequence>0),
 actor_id uuid not null,
 tariff_id text not null check(tariff_id ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(tariff_id)<=100),
 expected_revision text not null check(expected_revision ~ '^[a-f0-9]{64}$'),
 previous jsonb not null check(jsonb_typeof(previous)='object'),
 next jsonb not null check(jsonb_typeof(next)='object'),
 reason text not null check(char_length(reason) between 3 and 500 and reason=btrim(reason)),
 changed boolean not null,
 created_at timestamptz not null default clock_timestamp() check(isfinite(created_at)),
 check(previous->>'id'=tariff_id and next->>'id'=tariff_id and previous->>'action'=next->>'action'),
 check(previous->>'revision'=expected_revision),
 check(changed=((previous-'revision')<>(next-'revision'))),
 check(changed=((previous->>'revision')<>(next->>'revision')))
);
create index admin_tariff_changes_target_idx on app_admin.tariff_changes(tariff_id,sequence desc);
revoke all on app_admin.tariff_changes,app_admin.tariff_changes_sequence_seq from public;
create trigger admin_tariff_changes_immutable before update or delete or truncate on app_admin.tariff_changes
 for each statement execute function app_admin.guard_user_changes();

create function app_admin.tariff_view(value app.tariffs,generation bigint) returns jsonb
 language sql immutable strict set search_path=pg_catalog,pg_temp as $$
 select jsonb_build_object('id',value.id,'action',value.action,'name',value.name,'price',value.price::text,
  'durationDays',value.duration_days,'active',value.active,'revision',encode(sha256(convert_to(
   jsonb_build_array(value.id,value.action,value.name,value.price::text,value.duration_days,value.active,generation)::text,'UTF8')),'hex'))
$$;
revoke all on function app_admin.tariff_view(app.tariffs,bigint) from public;

create function app_admin.tariff_access(p_session_hash text,p_actor uuid,p_action text,p_target text,p_operation uuid,
 p_expected text,p_name text,p_price text,p_duration integer,p_active boolean,p_reason text) returns jsonb
 language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare
 actor app.users%rowtype; target app.tariffs%rowtype; saved app_admin.tariff_changes%rowtype;
 trim_chars constant text:=U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF';
 html_pattern constant text:=U&'<[\0009-\000D\0020\00A0\1680\2000-\200A\2028\2029\202F\205F\3000\FEFF]*(/?[a-zA-Z][^<>]*|![^<>]*|[?][^<>]*)>';
 previous jsonb; next jsonb; generation bigint; event_sequence bigint; changed boolean; answer jsonb; refresh_count integer;
begin
 if session_user<>'blizhniy_user_operator' or current_setting('transaction_isolation')<>'read committed' or
  p_session_hash is null or p_session_hash !~ '^[a-f0-9]{64}$' or p_actor is null then
  raise exception using errcode='PTA01',message='Admin access required';end if;
 if p_action is null or p_action not in ('list','change','recover') or
  (p_action='list' and (p_target is not null or p_operation is not null or p_expected is not null or p_name is not null or p_price is not null or p_duration is not null or p_active is not null or p_reason is not null)) or
  (p_action in ('change','recover') and (p_target is null or p_target !~ '^[a-z0-9]+(-[a-z0-9]+)*$' or char_length(p_target)>100 or p_operation is null)) or
  (p_action='recover' and (p_expected is not null or p_name is not null or p_price is not null or p_duration is not null or p_active is not null or p_reason is not null)) or
  (p_action='change' and (p_expected is null or p_expected !~ '^[a-f0-9]{64}$' or p_name is null or char_length(p_name) not between 1 and 200 or p_name<>btrim(p_name,trim_chars) or
   p_name ~ U&'[\0001-\001F\007F-\009F\061C\200E\200F\202A-\202E\2066-\2069]' or p_name ~ html_pattern or
   p_price is null or p_price !~ '^(0|[1-9][0-9]{0,9})\.[0-9]{2}$' or p_duration is not null and p_duration not between 1 and 3650 or p_active is null or
   p_reason is null or char_length(p_reason) not between 3 and 500 or p_reason<>btrim(p_reason,trim_chars) or
   p_reason ~ U&'[\0001-\001F\007F-\009F\061C\200E\200F\202A-\202E\2066-\2069]' or p_reason ~ html_pattern)) then
  raise exception using errcode='PTA08',message='Invalid tariff command';end if;
 perform u.id from app.users u join app.sessions s on s.user_id=u.id where u.id=p_actor and u.role='admin' and not u.is_blocked and u.email_verified_at is not null
  and s.token_hash=p_session_hash and s.auth_version=u.auth_version and s.scope='app' and s.expires_at>clock_timestamp() and s.last_seen_at>clock_timestamp()-interval '30 minutes';
 if not found then raise exception using errcode='PTA01',message='Admin access required';end if;
 if p_action='change' and not pg_try_advisory_xact_lock(187924,62) then raise exception using errcode='55P03',message='Tariff change busy';end if;
 select * into actor from app.users where id=p_actor for update nowait;
 if actor.role<>'admin' or actor.is_blocked or actor.email_verified_at is null then raise exception using errcode='PTA01',message='Admin access required';end if;
 perform token_hash from app.sessions where token_hash=p_session_hash and user_id=actor.id and auth_version=actor.auth_version and scope='app'
  and expires_at>clock_timestamp() and last_seen_at>clock_timestamp()-interval '30 minutes' for update nowait;
 if not found then raise exception using errcode='PTA01',message='Admin access required';end if;

 if p_action in ('change','recover') then
  select * into saved from app_admin.tariff_changes where id=p_operation;
  if found and (saved.actor_id<>actor.id or saved.tariff_id<>p_target) then raise exception using errcode='PTA02',message='Operation ID already used';end if;
 end if;
 if p_action='change' then
  if saved.id is not null then
   if saved.expected_revision<>p_expected or saved.next->>'name'<>p_name or saved.next->>'price'<>p_price or
    (saved.next->>'durationDays')::integer is distinct from p_duration or (saved.next->>'active')::boolean<>p_active or saved.reason<>p_reason then
    raise exception using errcode='PTA02',message='Operation ID already used';end if;
  else
   select * into target from app.tariffs where id=p_target for update nowait;
   if not found then raise exception using errcode='PTA04',message='Tariff not found';end if;
   select coalesce(max(sequence) filter(where c.changed),0) into generation from app_admin.tariff_changes c where tariff_id=p_target;
   previous:=app_admin.tariff_view(target,generation);
   if previous->>'revision'<>p_expected then raise exception using errcode='PTA03',message='Tariff changed';end if;
   changed:=row(target.name,target.price,target.duration_days,target.active) is distinct from row(p_name,p_price::numeric,p_duration,p_active);
   event_sequence:=nextval('app_admin.tariff_changes_sequence_seq');
   if changed then
    update app.tariffs set name=p_name,price=p_price::numeric,duration_days=p_duration,active=p_active where id=p_target returning * into target;
   end if;
   next:=app_admin.tariff_view(target,case when changed then event_sequence else generation end);
   insert into app_admin.tariff_changes(id,sequence,actor_id,tariff_id,expected_revision,previous,next,reason,changed)
    values(p_operation,event_sequence,actor.id,p_target,p_expected,previous,next,p_reason,changed);
  end if;
 end if;

 with current_rows as (
  select app_admin.tariff_view(t,coalesce((select max(sequence) from app_admin.tariff_changes c where c.tariff_id=t.id and c.changed),0)) as value,t.id
   from app.tariffs t where p_action='list' or t.id=p_target order by t.id limit 51
 ), bounded as (
  (select * from app_admin.tariff_changes where tariff_id=p_target order by sequence desc limit 10)
  union (select * from app_admin.tariff_changes where id=p_operation)
 ), receipts as (
  select id,actor_id as "actorId",tariff_id as "tariffId",expected_revision as "expectedRevision",c.previous,c.next,reason,c.changed,
   to_char(created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "createdAt",sequence from bounded c
 ) select jsonb_build_object('tariffs',coalesce((select jsonb_agg(value order by id) from current_rows),'[]'::jsonb),
  'receipt',(select to_jsonb(r)-'sequence' from receipts r where id=p_operation),
  'history',coalesce((select jsonb_agg(to_jsonb(r)-'sequence' order by sequence desc) from (select * from receipts order by sequence desc limit 10) r),'[]'::jsonb)) into answer;
 if jsonb_array_length(answer->'tariffs')>50 then raise exception using errcode='PTA08',message='Tariff catalog limit';end if;
 update app.sessions set last_seen_at=least(clock_timestamp(),expires_at) where token_hash=p_session_hash and user_id=actor.id and auth_version=actor.auth_version and scope='app'
  and expires_at>clock_timestamp() and last_seen_at>clock_timestamp()-interval '30 minutes';
 get diagnostics refresh_count=row_count;
 if refresh_count<>1 then raise exception using errcode='PTA01',message='Admin access required';end if;
 return answer;
end;
$$;
revoke all on function app_admin.tariff_access(text,uuid,text,text,uuid,text,text,text,integer,boolean,text) from public;
commit;
