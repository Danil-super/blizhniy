-- Hosted TEST repeat placement with a distinct immutable receipt after expiry.
begin;
set local lock_timeout='3s';
set local statement_timeout='10s';

create function app.specialist_repeat_basis(publication uuid,owner_id uuid,revision bigint,shop text) returns boolean
 language sql volatile security definer set search_path=pg_catalog as $$
 select exists(select 1 from app.service_publications s
  join app.payment_checkout_intents i on i.target_type='specialist' and i.target_id=s.id and i.owner_id=s.author_id
  join app.payment_orders o on o.id=i.id and o.status='succeeded'
  join app.specialist_checkout_terms terms on terms.intent_id=i.id
  join app.payment_fulfillments f on f.intent_id=i.id and f.published_at=s.published_at and f.expires_at=s.expires_at
  where s.id=$1 and s.author_id=$2 and s.revision=$3 and s.kind='specialist'
   and s.status='published' and s.is_paid and s.deleted_at is null and s.expires_at<=clock_timestamp()
   and i.is_test and i.tariff_id='specialist-publication' and i.merchant_shop_id ~ '^[1-9][0-9]{0,63}$'
   and ($4 is null or i.merchant_shop_id=$4)
   and i.request_body::jsonb#>>'{metadata,publicationMode}'='specialist-account-test-v1')
$$;
revoke all on function app.specialist_repeat_basis(uuid,uuid,bigint,text) from public;

-- Keep prior successes as history and retain an exclusive unsettled checkout.
drop index app.payment_order_active_target_idx;
create unique index payment_order_active_target_idx on app.payment_orders(owner_id,target_type,target_id)
 where status in ('created','pending') or (status='succeeded' and target_type not in ('listing','vacancy','workRequest','specialist'));

create function app.guard_specialist_repeat_purchase() returns trigger
 language plpgsql security definer set search_path=pg_catalog as $$
begin
 if current_setting('transaction_isolation')<>'read committed' then
  raise exception using errcode='PSP01',message='Specialist checkout requires read committed';end if;
 perform id from app.users where id=new.owner_id for update;
 if exists(select 1 from app.payment_orders o where o.owner_id=new.owner_id and o.target_type='specialist' and o.target_id=new.target_id and o.status='succeeded') then
  perform app.assert_placement_purchase_available(new.owner_id,new.target_type,new.target_id);
  perform id from app.service_publications where id=new.target_id for update;
  if not app.specialist_repeat_basis(new.target_id,new.owner_id,new.target_revision,null) then
   raise exception using errcode='PSP01',message='Specialist repeat requires the expired TEST period';end if;
 end if;
 return new;
end $$;
create trigger specialist_repeat_purchase_guard before insert on app.payment_orders
 for each row when (new.target_type='specialist') execute function app.guard_specialist_repeat_purchase();
alter table app.payment_orders enable always trigger specialist_repeat_purchase_guard;
revoke all on function app.guard_specialist_repeat_purchase() from public;

create or replace function app.specialist_checkout_ready(publication uuid,owner uuid,revision bigint) returns boolean
 language sql volatile security definer set search_path=pg_catalog as $$
 select exists(select 1 from app.service_publications s
  join app.users u on u.id=s.author_id and not u.is_blocked and u.email_verified_at is not null
  join app.cabinet_profiles profile on profile.user_id=u.id and profile.profile->>'name'=s.form->>'title'
  join app.cities c on c.id=s.city_id and c.name=s.form->>'cityName'
  join app.specialist_categories p on p.id=s.profession_id and p.active
  join app.service_moderation m on m.publication_id=s.id and m.revision=s.revision and m.state='approved'
  where s.id=$1 and s.author_id=$2 and s.revision=$3 and s.kind='specialist'
   and s.deleted_at is null and (
    s.status='draft' and not s.is_paid and s.published_at is null and s.expires_at is null or
    s.status='published' and s.is_paid and s.published_at is not null and s.expires_at<=clock_timestamp())
   and app.phone_is_confirmed($2) and s.form->'placementRightConfirmed'='true'::jsonb
   and char_length(s.title) between 2 and 200 and char_length(btrim(s.form->>'description')) between 20 and 3000
   and s.form->>'price' ~ '^[0-9]+\.[0-9]{2}$' and (s.form->>'price')::numeric>=100
   and (coalesce(s.form->>'contactPhone','')<>'' or coalesce(s.form->>'email','')<>'' or coalesce(s.form->>'messengerUrl','')<>'')
   and s.form->'photoIds'='[]'::jsonb and s.form->'skills'='null'::jsonb and s.form->'experience'='null'::jsonb
   and coalesce(s.form->>'professionId',s.profession_id::text)=s.profession_id::text
   and not exists(select 1 from app.service_publication_photos where publication_id=s.id))
$$;

create or replace function app.guard_specialist_checkout_terms() returns trigger
 language plpgsql security definer set search_path=pg_catalog as $$
 declare purchase app.payment_checkout_intents; session_hash text; actor uuid; version bigint;
 begin
  if tg_op<>'INSERT' then raise exception using errcode='23514',message='Specialist checkout terms are immutable';end if;
  if current_setting('transaction_isolation')<>'read committed' then raise exception using errcode='PSP01',message='Specialist checkout requires read committed';end if;
  session_hash:=current_setting('blizhniy.specialist_checkout_session',true);
  if session_hash is null or session_hash !~ '^[a-f0-9]{64}$' then raise exception using errcode='PSP01',message='Specialist owner session required';end if;
  select user_id into actor from app.sessions where token_hash=session_hash;
  select auth_version into version from app.users where id=actor and not is_blocked and email_verified_at is not null for update;
  if not found then raise exception using errcode='PSP01',message='Specialist owner session required';end if;
  perform token_hash from app.sessions where token_hash=session_hash and user_id=actor and auth_version=version and scope='app'
   and expires_at>clock_timestamp() and last_seen_at>clock_timestamp()-interval '30 minutes' for update;
  if not found then raise exception using errcode='PSP01',message='Specialist owner session required';end if;
  select * into purchase from app.payment_checkout_intents where id=new.intent_id for update;
  if not found or purchase.owner_id<>actor or purchase.target_type<>'specialist' or not purchase.is_test
   or purchase.tariff_id<>'specialist-publication' or purchase.duration_days is null then
   raise exception using errcode='PSP01',message='Specialist TEST purchase required';end if;
  if purchase.merchant_shop_id='local-fixture-shop' then
   if purchase.request_body::jsonb->'metadata' ? 'publicationMode' then
    raise exception using errcode='PSP01',message='Unexpected simulator purchase mode';
   end if;
  else
   if purchase.request_body::jsonb#>>'{metadata,publicationMode}' is distinct from 'specialist-account-test-v1'
    or jsonb_typeof(purchase.request_body::jsonb->'receipt') is distinct from 'object' then
    raise exception using errcode='PSP01',message='Specialist TEST marker required';
   end if;
   perform owner_id from app.specialist_test_enrollment where owner_id=actor and shop_id=purchase.merchant_shop_id
    and enabled_at<=purchase.created_at for share;
   if not found then raise exception using errcode='PSP01',message='Specialist TEST enrollment required';end if;
  end if;
  perform id from app.payment_orders where id=purchase.id and status='created' for update;
  if not found then raise exception using errcode='PSP01',message='Unstarted specialist order required';end if;
  perform id from app.service_publications where id=purchase.target_id for update;
  perform id from app.cities where id=(select city_id from app.service_publications where id=purchase.target_id) for share;
  perform id from app.specialist_categories where id=(select profession_id from app.service_publications where id=purchase.target_id) for share;
  perform user_id from app.cabinet_profiles where user_id=actor for share;
  perform id from app.service_moderation where publication_id=purchase.target_id and revision=purchase.target_revision for share;
  if not app.specialist_checkout_ready(purchase.target_id,actor,purchase.target_revision) or
   not exists(select 1 from app.tariffs where id=purchase.tariff_id and action='specialist_publication' and active and price>0
    and price=purchase.amount and duration_days=purchase.duration_days and duration_days between 1 and 3650) or
   exists(select 1 from app.payment_dispatch_anchors where intent_id=purchase.id) or exists(select 1 from app.payment_provider_links where intent_id=purchase.id) then
   raise exception using errcode='PSP01',message='Specialist purchase terms changed';end if;
  if exists(select 1 from app.service_publications where id=purchase.target_id and is_paid) and
   not app.specialist_repeat_basis(purchase.target_id,actor,purchase.target_revision,purchase.merchant_shop_id) then
   raise exception using errcode='PSP01',message='Specialist repeat requires the expired TEST period';end if;
  -- The admission may have waited on enrollment, the target or a reference after locking the session.
  if not exists(select 1 from app.sessions where token_hash=session_hash and user_id=actor and auth_version=version and scope='app'
   and expires_at>clock_timestamp() and last_seen_at>clock_timestamp()-interval '30 minutes') then
   raise exception using errcode='PSP01',message='Specialist owner session expired';
  end if;
  new.created_at:=clock_timestamp();return new;
 end $$;

create or replace function app.guard_specialist_payment_fulfillment() returns trigger
 language plpgsql security definer set search_path=pg_catalog as $$
 declare purchase app.payment_checkout_intents;
 begin
  select * into purchase from app.payment_checkout_intents where id=new.intent_id;
  if purchase.target_type is distinct from 'specialist' then return new;end if;
  if current_setting('transaction_isolation')<>'read committed' or new.published_at is not null or new.expires_at is not null then
   raise exception using errcode='PSP03',message='Specialist period is server assigned';end if;
  perform id from app.users where id=purchase.owner_id for update;
  select * into purchase from app.payment_checkout_intents where id=new.intent_id for update;
  perform id from app.payment_orders where id=purchase.id for update;
  perform id from app.service_publications where id=purchase.target_id for update;
  perform id from app.cities where id=(select city_id from app.service_publications where id=purchase.target_id) for share;
  perform id from app.specialist_categories where id=(select profession_id from app.service_publications where id=purchase.target_id) for share;
  perform user_id from app.cabinet_profiles where user_id=purchase.owner_id for share;
  perform id from app.service_moderation where publication_id=purchase.target_id and revision=purchase.target_revision for share;
  if not purchase.is_test or purchase.tariff_id<>'specialist-publication' or purchase.duration_days is null or
   not exists(select 1 from app.specialist_checkout_terms where intent_id=purchase.id) or
   not exists(select 1 from app.payment_orders where id=purchase.id and status='succeeded') or
   not exists(select 1 from app.payment_provider_links l join app.payment_verifications v on v.intent_id=l.intent_id and v.provider_payment_id=l.provider_payment_id
    where l.intent_id=purchase.id and v.status='succeeded' and v.captured_at is not null and v.captured_at::timestamptz>=purchase.created_at and v.captured_at::timestamptz<=clock_timestamp()) then
   raise exception using errcode='PSP03',message='Specialist capture or target unavailable';end if;
  if purchase.request_body::jsonb#>>'{metadata,publicationMode}'='specialist-account-test-v1'
   and not app.phone_is_confirmed(purchase.owner_id) then
   raise exception using errcode='P7601',message='Verified phone required';end if;
  if not app.specialist_checkout_ready(purchase.target_id,purchase.owner_id,purchase.target_revision) then
   raise exception using errcode='PSP03',message='Specialist capture or target unavailable';end if;
  if exists(select 1 from app.service_publications where id=purchase.target_id and is_paid) and
   not app.specialist_repeat_basis(purchase.target_id,purchase.owner_id,purchase.target_revision,purchase.merchant_shop_id) then
   raise exception using errcode='PSP03',message='Specialist repeat basis changed';end if;
  new.published_at:=clock_timestamp();new.expires_at:=new.published_at+purchase.duration_days*interval '24 hours';return new;
 end $$;

create or replace function app.apply_specialist_payment_fulfillment() returns trigger
 language plpgsql security definer set search_path=pg_catalog as $$
 declare purchase app.payment_checkout_intents;
 begin
  select * into purchase from app.payment_checkout_intents where id=new.intent_id;
  if purchase.target_type is distinct from 'specialist' then return new;end if;
  update app.service_publications set status='published',is_paid=true,published_at=new.published_at,expires_at=new.expires_at,updated_at=clock_timestamp()
   where id=purchase.target_id and author_id=purchase.owner_id and kind='specialist' and revision=purchase.target_revision
    and deleted_at is null and (
     status='draft' and not is_paid and published_at is null and expires_at is null or
     status='published' and is_paid and published_at is not null and expires_at<=new.published_at);
  if not found then raise exception using errcode='PSP03',message='Specialist publication changed';end if;
  return new;
 end $$;

create or replace function app.guard_specialist_publication_window() returns trigger
 language plpgsql security definer set search_path=pg_catalog as $$
 begin
  if new.kind<>'specialist' then
   if tg_op='UPDATE' and old.kind='specialist' and old.is_paid then raise exception using errcode='PSP03',message='Paid specialist kind is immutable';end if;
   return new;
  end if;
  if tg_op='UPDATE' and row(new.status,new.is_paid,new.published_at,new.expires_at,new.id,new.author_id,new.kind)
   is not distinct from row(old.status,old.is_paid,old.published_at,old.expires_at,old.id,old.author_id,old.kind) then return new;end if;
  -- A verified full refund may retire the exact paid period and retain its dates for history.
  if tg_op='UPDATE' and old.is_paid and not new.is_paid and
   row(new.id,new.author_id,new.kind,new.revision,new.published_at,new.expires_at)
    is not distinct from row(old.id,old.author_id,old.kind,old.revision,old.published_at,old.expires_at) and
   new.status=(case when old.status in ('published','paid') then 'archived' else old.status end) and
   exists(select 1 from app.payment_fulfillments f
    join app.payment_checkout_intents i on i.id=f.intent_id
    join app.payment_orders o on o.id=i.id and o.status='refunded'
    join app.payment_refund_reservations r on r.payment_intent_id=i.id and r.amount=i.amount and r.merchant_shop_id=i.merchant_shop_id and r.is_test
    join app.payment_refund_approvals a on a.id=r.id and a.payment_intent_id=i.id and a.amount=i.amount
     and a.policy_version='placement-full-admin-v1' and a.fiscal_mode='provider-automatic-full'
    join app.payment_refund_provider_links l on l.operation_id=r.id
    join app.payment_refund_observations v on v.operation_id=l.operation_id and v.provider_refund_id=l.provider_refund_id and v.status='succeeded'
    where i.target_type='specialist' and i.owner_id=new.author_id and i.target_id=new.id
     and f.published_at=new.published_at and f.expires_at=new.expires_at and app.refund_target_admitted(i.id,r.id))
   then return new;end if;
  if tg_op='UPDATE' and old.published_at is not null and
   row(new.published_at,new.expires_at) is distinct from row(old.published_at,old.expires_at) and
   (not old.is_paid or not new.is_paid or old.status<>'published' or new.status<>'published' or
    new.published_at is null or new.expires_at is null or new.published_at<old.expires_at) then
   raise exception using errcode='PSP03',message='Specialist paid period cannot be moved backwards';end if;
  if new.is_paid or new.status in ('published','paid') or new.published_at is not null or new.expires_at is not null then
   if not exists(select 1 from app.payment_fulfillments f join app.payment_checkout_intents i on i.id=f.intent_id
    join app.specialist_checkout_terms terms on terms.intent_id=i.id join app.payment_orders o on o.id=i.id and o.status='succeeded'
    where i.target_type='specialist' and i.owner_id=new.author_id and i.target_id=new.id and i.target_revision=new.revision
     and i.is_test and f.published_at=new.published_at and f.expires_at=new.expires_at) then
    raise exception using errcode='PSP03',message='Specialist publication requires its recorded receipt';end if;
  end if;
  return new;
 end $$;

commit;
