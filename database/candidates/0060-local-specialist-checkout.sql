-- Proposed local synthetic first placement only. No roles, grants or activation.
begin;
set local lock_timeout='3s';
set local statement_timeout='10s';
create table app.specialist_checkout_terms (
 intent_id uuid primary key references app.payment_checkout_intents(id) on delete restrict,
 created_at timestamptz not null default clock_timestamp() check(isfinite(created_at))
);
create function app.specialist_checkout_ready(publication uuid,owner uuid,revision bigint) returns boolean
 language sql volatile security definer set search_path=pg_catalog as $$
 select exists(select 1 from app.service_publications s
  join app.users u on u.id=s.author_id and not u.is_blocked and u.email_verified_at is not null
  join app.cabinet_profiles profile on profile.user_id=u.id and profile.profile->>'name'=s.form->>'title'
  join app.cities c on c.id=s.city_id and c.name=s.form->>'cityName'
  join app.specialist_categories p on p.id=s.profession_id and p.active
  join app.service_moderation m on m.publication_id=s.id and m.revision=s.revision and m.state='approved'
  where s.id=$1 and s.author_id=$2 and s.revision=$3 and s.kind='specialist'
   and s.status='draft' and not s.is_paid and s.deleted_at is null and s.published_at is null and s.expires_at is null
   and app.phone_is_confirmed($2) and s.form->'placementRightConfirmed'='true'::jsonb
   and char_length(s.title) between 2 and 200 and char_length(btrim(s.form->>'description')) between 20 and 3000
   and s.form->>'price' ~ '^[0-9]+\.[0-9]{2}$' and (s.form->>'price')::numeric>=100
   and (coalesce(s.form->>'contactPhone','')<>'' or coalesce(s.form->>'email','')<>'' or coalesce(s.form->>'messengerUrl','')<>'')
   and s.form->'photoIds'='[]'::jsonb and s.form->'skills'='null'::jsonb and s.form->'experience'='null'::jsonb
   and coalesce(s.form->>'professionId',s.profession_id::text)=s.profession_id::text
   and not exists(select 1 from app.service_publication_photos where publication_id=s.id))
$$;
create function app.guard_specialist_checkout_terms() returns trigger
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
  if not found or purchase.owner_id<>actor or purchase.target_type<>'specialist' or not purchase.is_test or purchase.merchant_shop_id<>'local-fixture-shop'
   or purchase.tariff_id<>'specialist-publication' or purchase.duration_days is null then
   raise exception using errcode='PSP01',message='Local specialist purchase required';end if;
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
  new.created_at:=clock_timestamp();return new;
 end $$;
create trigger specialist_checkout_terms_guard before insert or update or delete on app.specialist_checkout_terms
 for each row execute function app.guard_specialist_checkout_terms();
create trigger specialist_checkout_terms_truncate_guard before truncate on app.specialist_checkout_terms
 for each statement execute function app.guard_specialist_checkout_terms();
create function app.guard_specialist_checkout_edit() returns trigger
 language plpgsql security definer set search_path=pg_catalog as $$
 begin
  if old.kind<>'specialist' then if tg_op='DELETE' then return old;end if;return new;end if;
  if tg_op='UPDATE' and (to_jsonb(new)-array['status','is_paid','published_at','expires_at','updated_at','title']) is not distinct from
   (to_jsonb(old)-array['status','is_paid','published_at','expires_at','updated_at','title']) then return new;end if;
  if current_setting('transaction_isolation')<>'read committed' then raise exception using errcode='PSP02',message='Specialist edit requires read committed';end if;
  if tg_op='UPDATE' and (row(new.id,new.author_id,new.kind) is distinct from row(old.id,old.author_id,old.kind) or
   new.revision not in (old.revision,old.revision+1) or
   row(new.form,new.city_id,new.profession_id) is distinct from row(old.form,old.city_id,old.profession_id) and new.revision<>old.revision+1) then
   raise exception using errcode='PSP02',message='Specialist material edit requires the next revision';end if;
  if exists(select 1 from app.payment_orders o where target_type='specialist' and target_id=old.id and
   (status in ('created','pending') or status='succeeded' and not exists(select 1 from app.payment_fulfillments where intent_id=o.id))) then
   raise exception using errcode='PSP02',message='Specialist checkout prevents editing';end if;
  if tg_op='DELETE' then return old;end if;return new;
 end $$;
create trigger specialist_checkout_edit_guard before update or delete on app.service_publications
 for each row execute function app.guard_specialist_checkout_edit();
create function app.guard_specialist_checkout_photo() returns trigger
 language plpgsql security definer set search_path=pg_catalog as $$
 declare publication uuid;
 begin
  for publication in select id from app.service_publications where kind='specialist' and id=any(array[case when tg_op<>'INSERT' then old.publication_id end,case when tg_op<>'DELETE' then new.publication_id end]) order by id loop
   if current_setting('transaction_isolation')<>'read committed' then raise exception using errcode='PSP02',message='Specialist photo edit requires read committed';end if;
   perform id from app.users where id=(select author_id from app.service_publications where id=publication) for update;
   perform id from app.service_publications where id=publication and kind='specialist' for update;
   if found and exists(select 1 from app.payment_orders o where target_type='specialist' and target_id=publication and
    (status in ('created','pending') or status='succeeded' and not exists(select 1 from app.payment_fulfillments where intent_id=o.id))) then
    raise exception using errcode='PSP02',message='Specialist checkout prevents photo changes';end if;
  end loop;
  if tg_op='DELETE' then return old;end if;return new;
 end $$;
create trigger specialist_checkout_photo_guard before insert or update or delete on app.service_publication_photos
 for each row execute function app.guard_specialist_checkout_photo();
create function app.guard_specialist_payment_fulfillment() returns trigger
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
  if not purchase.is_test or purchase.merchant_shop_id<>'local-fixture-shop' or purchase.tariff_id<>'specialist-publication' or purchase.duration_days is null or
   not exists(select 1 from app.specialist_checkout_terms where intent_id=purchase.id) or
   not exists(select 1 from app.payment_orders where id=purchase.id and status='succeeded') or
   not exists(select 1 from app.payment_provider_links l join app.payment_verifications v on v.intent_id=l.intent_id and v.provider_payment_id=l.provider_payment_id
    where l.intent_id=purchase.id and v.status='succeeded' and v.captured_at is not null and v.captured_at::timestamptz>=purchase.created_at and v.captured_at::timestamptz<=clock_timestamp()) or
   not app.specialist_checkout_ready(purchase.target_id,purchase.owner_id,purchase.target_revision) then
   raise exception using errcode='PSP03',message='Specialist capture or target unavailable';end if;
  new.published_at:=clock_timestamp();new.expires_at:=new.published_at+purchase.duration_days*interval '24 hours';return new;
 end $$;
-- Take the user lock before older financial fences take the intent lock.
create trigger a_specialist_payment_fulfillment_guard before insert on app.payment_fulfillments
 for each row execute function app.guard_specialist_payment_fulfillment();
create function app.apply_specialist_payment_fulfillment() returns trigger
 language plpgsql security definer set search_path=pg_catalog as $$
 declare purchase app.payment_checkout_intents;
 begin
  select * into purchase from app.payment_checkout_intents where id=new.intent_id;
  if purchase.target_type is distinct from 'specialist' then return new;end if;
  update app.service_publications set status='published',is_paid=true,published_at=new.published_at,expires_at=new.expires_at,updated_at=clock_timestamp()
   where id=purchase.target_id and author_id=purchase.owner_id and kind='specialist' and revision=purchase.target_revision
    and status='draft' and not is_paid and published_at is null and expires_at is null and deleted_at is null;
  if not found then raise exception using errcode='PSP03',message='Specialist publication changed';end if;
  return new;
 end $$;
create trigger specialist_payment_fulfillment_effect after insert on app.payment_fulfillments
 for each row execute function app.apply_specialist_payment_fulfillment();
create function app.guard_specialist_publication_window() returns trigger
 language plpgsql security definer set search_path=pg_catalog as $$
 begin
  if new.kind<>'specialist' then
   if tg_op='UPDATE' and old.kind='specialist' and old.is_paid then raise exception using errcode='PSP03',message='Paid specialist kind is immutable';end if;
   return new;
  end if;
  if tg_op='UPDATE' and row(new.status,new.is_paid,new.published_at,new.expires_at,new.id,new.author_id,new.kind)
   is not distinct from row(old.status,old.is_paid,old.published_at,old.expires_at,old.id,old.author_id,old.kind) then return new;end if;
  if new.is_paid or new.status in ('published','paid') or new.published_at is not null or new.expires_at is not null then
   if not exists(select 1 from app.payment_fulfillments f join app.payment_checkout_intents i on i.id=f.intent_id
    join app.specialist_checkout_terms terms on terms.intent_id=i.id join app.payment_orders o on o.id=i.id and o.status='succeeded'
    where i.target_type='specialist' and i.owner_id=new.author_id and i.target_id=new.id and i.target_revision=new.revision
     and i.is_test and i.merchant_shop_id='local-fixture-shop' and f.published_at=new.published_at and f.expires_at=new.expires_at) then
    raise exception using errcode='PSP03',message='Specialist publication requires its recorded receipt';end if;
  end if;
  return new;
 end $$;
create trigger specialist_publication_window_guard before insert or update on app.service_publications
 for each row execute function app.guard_specialist_publication_window();
revoke all on app.specialist_checkout_terms from public;
revoke all on function app.specialist_checkout_ready(uuid,uuid,bigint),app.guard_specialist_checkout_terms(),app.guard_specialist_checkout_edit(),
 app.guard_specialist_checkout_photo(),app.guard_specialist_payment_fulfillment(),app.apply_specialist_payment_fulfillment(),app.guard_specialist_publication_window() from public;
commit;
