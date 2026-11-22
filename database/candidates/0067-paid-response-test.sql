begin;
set local lock_timeout = '3s';
set local statement_timeout = '10s';
create schema app_response;
revoke all on schema app_response from public;
create table app_response.admissions (
  intent_id uuid primary key references app.payment_orders(id),
  applicant_id uuid not null references app.users(id),
  shop_id text not null check (shop_id ~ '^[1-9][0-9]{0,63}$')
);
create table app_response.deliveries (
  intent_id uuid primary key references app_response.admissions(intent_id),
  application_id uuid unique not null references app.applications(id),
  sent_at timestamptz not null check (isfinite(sent_at))
);
create function app_response.deliver(p_intent uuid,p_claim uuid) returns text
language plpgsql security definer set search_path=pg_catalog as $$
declare
  purchase app.payment_checkout_intents; order_status text; a app.applications;
  job app.work_publications; profile app.service_publications; recipient uuid;
  sent timestamptz;
begin
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'Delivery requires read committed';
  end if;
  select i.* into purchase from app.payment_checkout_intents i
    join app_response.admissions admitted on admitted.intent_id=i.id
      and admitted.applicant_id=i.owner_id and admitted.shop_id=i.merchant_shop_id
    where i.id=p_intent and i.is_test and i.target_type='application'
      and i.tariff_id='job-response' and i.duration_days is null for update of i;
  if not found then return 'not_admitted'; end if;
  if not exists(select 1 from app.payment_reconciliation_jobs q where q.intent_id=p_intent and q.claim_id=p_claim
    and q.state='processing' and q.lease_until>clock_timestamp() for update nowait) then return 'lost'; end if;
  if exists(select 1 from app_response.deliveries where intent_id=p_intent) then return 'already_delivered'; end if;
  select o.status into order_status from app.payment_orders o where o.id=p_intent for update;
  if order_status is distinct from 'succeeded' or not exists(
    select 1 from app.payment_verifications v join app.payment_provider_links l
      on l.intent_id=v.intent_id and l.provider_payment_id=v.provider_payment_id
    where v.intent_id=p_intent and v.status='succeeded' and v.captured_at is not null
  ) then return 'capture_required'; end if;
  select * into a from app.applications where id=purchase.target_id and applicant_id=purchase.owner_id;
  if not found then return 'application_changed'; end if;
  select w.author_id into recipient from app.work_publications w where w.id=a.work_publication_id;
  if recipient is null or recipient=a.applicant_id then return 'account_unavailable'; end if;
  perform u.id from app.users u where u.id in (recipient,purchase.owner_id) order by u.id for share nowait;
  if (select count(*) from app.users where id in (recipient,purchase.owner_id)
      and email_verified_at is not null and not is_blocked)<>2 then return 'account_unavailable'; end if;
  select * into job from app.work_publications where id=a.work_publication_id for update nowait;
  if not found or job.author_id<>recipient or job.revision<>a.target_revision or job.status<>'published'
      or not job.is_paid or job.deleted_at is not null or job.published_at is null
      or job.published_at>clock_timestamp() or job.expires_at is null then return 'publication_changed'; end if;
  select * into profile from app.service_publications where id=a.specialist_publication_id for update nowait;
  if not found or profile.author_id<>purchase.owner_id or profile.kind<>'specialist'
      or profile.deleted_at is not null or profile.revision<>a.specialist_revision then return 'profile_changed'; end if;
  if not exists(select 1 from app.cities c where c.id=job.city_id and c.name=job.form->>'cityName' for share nowait)
    or not exists(select 1 from app.cities c where c.id=profile.city_id and c.name=profile.form->>'cityName' for share nowait)
    or not exists(select 1 from app.specialist_categories p where p.id=job.profession_id and p.active
      and (not(job.form?'professionId') or p.id::text=job.form->>'professionId') for share nowait)
    or not exists(select 1 from app.specialist_categories p where p.id=profile.profession_id and p.active
      and (not(profile.form?'professionId') or p.id::text=profile.form->>'professionId') for share nowait)
    then return 'reference_unavailable'; end if;
  if job.kind='workRequest' and exists(select 1 from app.applications where work_publication_id=job.id
    and status='selected' and is_paid and sent_at is not null) then return 'publication_closed'; end if;
  sent:=clock_timestamp();
  if job.expires_at<=sent then return 'publication_closed'; end if;
  if not exists(select 1 from app.payment_reconciliation_jobs where intent_id=p_intent and claim_id=p_claim
    and state='processing' and lease_until>clock_timestamp()) then return 'lost'; end if;
  update app.applications set is_paid=true,status='sent',sent_at=sent,updated_at=sent,revision=revision+1
   where id=a.id and applicant_id=purchase.owner_id and work_publication_id=job.id and specialist_publication_id=profile.id
    and revision=purchase.target_revision and target_revision=job.revision and specialist_revision=profile.revision
    and revision<9223372036854775807 and status='pending_payment' and not is_paid and sent_at is null
    and not exists(select 1 from app.application_withdrawals w where w.application_id=a.id);
  if not found then return 'application_changed'; end if;
  insert into app_response.deliveries values(p_intent,a.id,sent);
  insert into app.notifications(user_id,event_key,category,tone,title,body,action_href)
    values(recipient,'application_paid:'||a.id::text,'message','info','Новый отклик',
    case when job.kind='vacancy' then 'На вашу вакансию' else 'На ваш заказ' end||' поступил отклик. Анкета и контакты доступны в кабинете.','/cabinet/otkliki');
  return 'delivered';
end $$;
revoke all on function app_response.deliver(uuid,uuid) from public;
revoke all on all tables in schema app_response from public;
grant select(intent_id,applicant_id,shop_id) on app_response.admissions to blizhniy_payment_reconciler;
grant usage on schema app_response to blizhniy_payment_reconciler;
grant execute on function app_response.deliver(uuid,uuid) to blizhniy_payment_reconciler;
create table app_response.enrollment (
 singleton boolean primary key check(singleton),
 owner_id uuid not null references app.users(id),
 shop_id text not null check(shop_id ~ '^[1-9][0-9]{0,63}$'),
 vat_code integer not null check(vat_code between 1 and 12)
);
create function app_response.admit(p_intent uuid,p_session text) returns boolean
 language sql volatile security definer set search_path=pg_catalog as $$
 with eligible as (
 select i.id,i.owner_id,i.merchant_shop_id from app.payment_checkout_intents i
 join app_response.enrollment e on e.owner_id=i.owner_id and e.shop_id=i.merchant_shop_id
 join app.users u on u.id=i.owner_id and u.email_verified_at is not null and not u.is_blocked
 join app.sessions s on s.user_id=u.id and s.auth_version=u.auth_version and s.token_hash=p_session
 join app.payment_orders o on o.id=i.id and o.owner_id=i.owner_id and o.target_id=i.target_id
   and o.target_revision=i.target_revision and o.target_type=i.target_type
 join app.applications a on a.id=i.target_id and a.applicant_id=i.owner_id and a.revision=i.target_revision
 join app.tariffs t on t.id=i.tariff_id and t.action='job_response' and t.active and t.price=i.amount and t.duration_days is null
 where i.id=p_intent and i.is_test and i.target_type='application' and i.tariff_id='job-response' and i.duration_days is null
   and o.status='created' and s.scope='app' and s.expires_at>clock_timestamp() and s.last_seen_at>clock_timestamp()-interval '30 minutes'
   and a.status='pending_payment' and not a.is_paid and a.sent_at is null and app.phone_is_confirmed(u.id)
   and i.request_body::jsonb #>> '{receipt,customer,email}'=u.email::text
   and i.request_body::jsonb #> '{receipt,items,0,vat_code}'=to_jsonb(e.vat_code)
   and i.request_body::jsonb #>> '{confirmation,return_url}'='https://xn----9sbphbgks4a4a.xn--p1ai/oplata/'||i.id::text||'?type=application'
 for share of e,t
 ), recorded as (
 insert into app_response.admissions(intent_id,applicant_id,shop_id) select * from eligible returning intent_id
 )
 select exists(select 1 from recorded);
$$;
create function app_response.authorized_for_dispatch(p_intent uuid,p_session text) returns boolean
 language sql volatile security definer set search_path=pg_catalog as $$
 select exists(select 1 from app_response.admissions a
   join app_response.enrollment e on e.owner_id=a.applicant_id and e.shop_id=a.shop_id
   join app.users u on u.id=a.applicant_id and u.email_verified_at is not null and not u.is_blocked
   join app.sessions s on s.user_id=u.id and s.auth_version=u.auth_version and s.token_hash=p_session
   where a.intent_id=p_intent and s.scope='app' and s.expires_at>clock_timestamp()
   and s.last_seen_at>clock_timestamp()-interval '30 minutes' and app.phone_is_confirmed(u.id) for share of e);
$$;
revoke all on function app_response.authorized_for_dispatch(uuid,text) from public;
grant execute on function app_response.authorized_for_dispatch(uuid,text) to blizhniy_runtime;
revoke all on function app_response.admit(uuid,text) from public;
grant usage on schema app_response to blizhniy_runtime;
grant select(intent_id,applicant_id,shop_id) on app_response.admissions to blizhniy_runtime;
grant execute on function app_response.admit(uuid,text) to blizhniy_runtime;
create function app_response.read_delivery(p_intent uuid,p_session text) returns text
 language sql stable security definer set search_path=pg_catalog as $$
 select to_char(d.sent_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
 from app_response.deliveries d join app_response.admissions a using(intent_id)
 join app.applications r on r.id=d.application_id and r.applicant_id=a.applicant_id and r.is_paid and r.sent_at=d.sent_at
 join app.users u on u.id=a.applicant_id and u.email_verified_at is not null and not u.is_blocked
 join app.sessions s on s.user_id=u.id and s.auth_version=u.auth_version and s.token_hash=p_session
 where d.intent_id=p_intent and s.scope='app' and s.expires_at>statement_timestamp()
   and s.last_seen_at>statement_timestamp()-interval '30 minutes';
$$;
revoke all on function app_response.read_delivery(uuid,text) from public;
grant execute on function app_response.read_delivery(uuid,text) to blizhniy_runtime;

create function app_response.can_prepare(p_owner uuid,p_session text,p_shop text,p_vat integer) returns boolean
 language sql stable security definer set search_path=pg_catalog as $$
 select exists(select 1 from app_response.enrollment e join app.users u on u.id=e.owner_id
   join app.sessions s on s.user_id=u.id and s.auth_version=u.auth_version
   where e.owner_id=p_owner and s.token_hash=p_session and e.shop_id=p_shop and e.vat_code=p_vat
   and s.scope='app' and s.expires_at>statement_timestamp() and s.last_seen_at>statement_timestamp()-interval '30 minutes'
   and u.email_verified_at is not null and not u.is_blocked and app.phone_is_confirmed(u.id));
$$;
revoke all on function app_response.can_prepare(uuid,text,text,integer) from public;
grant execute on function app_response.can_prepare(uuid,text,text,integer) to blizhniy_runtime;
commit;
