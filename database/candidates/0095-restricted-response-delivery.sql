begin;
set local lock_timeout='3s';
set local statement_timeout='10s';

create or replace function app_response.deliver(p_intent uuid,p_claim uuid) returns text
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
  -- Check after the publication lock so a committed moderation decision is visible.
  if exists(select 1 from app_publication_restriction.restrictions r
    where r.kind=job.kind and r.publication_id=job.id) then return 'publication_closed'; end if;
  select * into profile from app.service_publications where id=a.specialist_publication_id for update nowait;
  if not found or profile.author_id<>purchase.owner_id or profile.kind<>'specialist'
      or profile.deleted_at is not null or profile.revision<>a.specialist_revision then return 'profile_changed'; end if;
  if exists(select 1 from app_publication_restriction.restrictions r
    where r.kind=profile.kind and r.publication_id=profile.id) then return 'profile_changed'; end if;
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

commit;
