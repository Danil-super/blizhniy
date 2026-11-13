-- Local candidate only: immutable event terms and once-only service placement.
-- No grants, role changes, checkout activation or automatic migration.
begin;
set local lock_timeout='3s';
set local statement_timeout='10s';
create function app.fair_event_at(moment timestamptz) returns table(event_date date,ends_at timestamptz)
 language sql immutable strict set search_path=pg_catalog as $$
 with day as(select (moment at time zone 'Europe/Moscow')::date value),
 last_day as(select value,(date_trunc('month',value)+interval '1 month -1 day')::date last from day),
 current_event as(select value,last-extract(dow from last)::integer event from last_day),
 chosen as(select case when value<=event then event else
  (date_trunc('month',value)+interval '2 months -1 day')::date-
   extract(dow from (date_trunc('month',value)+interval '2 months -1 day')::date)::integer end event from current_event)
 select event,((event+1)::timestamp at time zone 'Europe/Moscow') from chosen
$$;
create table app.service_payment_terms (
 intent_id uuid primary key references app.payment_checkout_intents(id) on delete restrict,
 fair_date date check(isfinite(fair_date)),
 fair_ends_at timestamptz check(isfinite(fair_ends_at)),
 created_at timestamptz not null default clock_timestamp() check(isfinite(created_at)),
 check((fair_date is null)=(fair_ends_at is null))
);
create function app.guard_service_payment_terms() returns trigger language plpgsql security definer set search_path=pg_catalog as $$
 declare purchase app.payment_checkout_intents%rowtype; target app.service_publications%rowtype; kind text;
 begin
  if tg_op<>'INSERT' then raise exception using errcode='23514',message='Service payment terms are immutable';end if;
  if new.fair_date is not null or new.fair_ends_at is not null then raise exception using errcode='23514',message='Service dates are server assigned';end if;
  perform id from app.users where id=(select owner_id from app.payment_checkout_intents where id=new.intent_id) for update;
  select * into purchase from app.payment_checkout_intents where id=new.intent_id for update;
  kind:=case purchase.target_type when 'fair_application' then 'fair' when 'ad_marquee' then 'marquee' end;
  if kind is null or not purchase.is_test or
   (kind='fair' and (purchase.duration_days is not null or purchase.tariff_id<>'fair-participation')) or
   (kind='marquee' and (purchase.duration_days is null or purchase.tariff_id<>'ad-marquee')) or
   not exists(select 1 from app.users where id=purchase.owner_id and not is_blocked and email_verified_at is not null) or
   not app.phone_is_confirmed(purchase.owner_id) then
   raise exception using errcode='23514',message='Service purchase unavailable';
  end if;
  select * into target from app.service_publications where id=purchase.target_id for update;
  if not found or target.author_id<>purchase.owner_id or target.kind<>kind or target.revision<>purchase.target_revision or
   target.deleted_at is not null or target.status<>'draft' or target.is_paid or target.published_at is not null or target.expires_at is not null or
   not exists(select 1 from app.service_moderation where publication_id=target.id and revision=target.revision and state='approved') or
   not exists(select 1 from app.payment_orders where id=purchase.id and status='created') or
   not exists(select 1 from app.tariffs where id=purchase.tariff_id and action=case kind when 'fair' then 'fair_participation' else 'ad_marquee' end
    and active and price=purchase.amount and duration_days is not distinct from purchase.duration_days) then
   raise exception using errcode='23514',message='Service target unavailable';
  end if;
  if exists(select 1 from app.payment_dispatch_anchors where intent_id=purchase.id) or
   exists(select 1 from app.payment_provider_links where intent_id=purchase.id) then
   raise exception using errcode='23514',message='Service terms must precede dispatch';
  end if;
  new.created_at:=clock_timestamp();
  if kind='fair' then select event_date,ends_at into new.fair_date,new.fair_ends_at from app.fair_event_at(new.created_at);end if;
  return new;
 end $$;
create trigger service_payment_terms_guard before insert or update or delete on app.service_payment_terms for each row execute function app.guard_service_payment_terms();
-- One shared predicate for discovery, FIFO and activation; never LIMIT before eligibility.
create function app.service_payment_eligible(payment uuid) returns boolean language sql volatile security definer set search_path=pg_catalog as $$
 select exists(select 1 from app.payment_checkout_intents i join app.payment_orders o on o.id=i.id and o.status='succeeded'
  join app.service_payment_terms terms on terms.intent_id=i.id
  join app.payment_provider_links link on link.intent_id=i.id
  join app.payment_verifications v on v.intent_id=i.id and v.provider_payment_id=link.provider_payment_id and v.status='succeeded'
  join app.users u on u.id=i.owner_id and not u.is_blocked and u.email_verified_at is not null
  join app.service_publications s on s.id=i.target_id and s.author_id=i.owner_id and s.revision=i.target_revision
   and s.kind=case i.target_type when 'fair_application' then 'fair' when 'ad_marquee' then 'marquee' end
  join app.service_moderation m on m.publication_id=s.id and m.revision=s.revision and m.state='approved'
  where i.id=payment and i.is_test and s.status='draft' and not s.is_paid and s.deleted_at is null and s.published_at is null and s.expires_at is null
   and v.captured_at is not null and v.captured_at::timestamptz>=o.created_at and v.captured_at::timestamptz<=clock_timestamp()
   and app.phone_is_confirmed(i.owner_id) and s.form->>'placementRightConfirmed'='true'
   and ((i.target_type='ad_marquee' and i.duration_days is not null and terms.fair_date is null and char_length(s.title) between 10 and 140) or
    (i.target_type='fair_application' and i.duration_days is null and terms.fair_ends_at>clock_timestamp() and exists(select 1 from app.cities c where c.id=s.city_id and c.name=s.form->>'cityName')
     and char_length(s.title)>=2 and char_length(s.form->>'description') between 1 and 3000
     and coalesce(s.form->>'contactPhone','')<>'' and coalesce(s.form->>'email','')<>''))
   and not exists(select 1 from app.payment_fulfillments where intent_id=i.id)
   and not exists(select 1 from app.payment_refund_reservations r where r.payment_intent_id=i.id and
    not exists(select 1 from app.payment_refund_observations outcome where outcome.operation_id=r.id and outcome.status='canceled'))
   and not exists(select 1 from app.payment_refund_approvals approval where approval.payment_intent_id=i.id and
    not exists(select 1 from app.payment_refund_reservations r join app.payment_refund_observations outcome on outcome.operation_id=r.id and outcome.status='canceled' where r.payment_intent_id=i.id))
   and coalesce(s.form->'photoIds','[]'::jsonb)=coalesce((select jsonb_agg(p.media_id::text order by p.position) from app.service_publication_photos p where p.publication_id=s.id),'[]'::jsonb)
   and not exists(select 1 from app.service_publication_photos p join app.media_objects image on image.id=p.media_id
    where p.publication_id=s.id and (image.owner_id<>s.author_id or image.state<>'ready'))
 )
$$;
create function app.guard_service_payment_fulfillment() returns trigger language plpgsql security definer set search_path=pg_catalog as $$
 declare purchase app.payment_checkout_intents%rowtype; terms app.service_payment_terms%rowtype; kind text; started timestamptz; captured text; earlier boolean;
 begin
  select * into purchase from app.payment_checkout_intents where id=new.intent_id;
  if purchase.target_type not in ('fair_application','ad_marquee') then return new;end if;
  if new.published_at is not null or new.expires_at is not null then raise exception using errcode='23514',message='Service window is server assigned';end if;
  if current_setting('transaction_isolation')<>'read committed' then raise exception using errcode='23514',message='Service fulfillment requires read committed';end if;
  perform id from app.users where id=purchase.owner_id for update;
  select * into purchase from app.payment_checkout_intents where id=new.intent_id for update;
  perform id from app.payment_orders where id=purchase.id for update;
  perform id from app.service_publications where id=purchase.target_id for update;
  if exists(select 1 from app.payment_fulfillments where intent_id=purchase.id) then raise exception using errcode='23505',message='Service already fulfilled';end if;
  if not app.service_payment_eligible(purchase.id) then raise exception using errcode='PSV01',message='Service payment not eligible';end if;
  select * into terms from app.service_payment_terms where intent_id=purchase.id;
  kind:=case purchase.target_type when 'fair_application' then 'fair' else 'marquee' end;
  if kind='marquee' then
   perform pg_advisory_xact_lock(170219,57);
   -- Separate statement after waiting: see committed slots and the oldest eligible capture.
   select left(captured_at,19)||'.'||rpad(coalesce(substring(captured_at from '[.]([0-9]+)Z$'),''),9,'0')||'Z' into captured from app.payment_verifications where intent_id=purchase.id;
   select exists(select 1 from app.payment_checkout_intents older join app.payment_verifications v on v.intent_id=older.id
    where older.target_type='ad_marquee' and ((left(v.captured_at,19)||'.'||rpad(coalesce(substring(v.captured_at from '[.]([0-9]+)Z$'),''),9,'0')||'Z') collate "C",older.id)<(captured collate "C",purchase.id) and app.service_payment_eligible(older.id)) into earlier;
   if earlier or (select count(*) from app.service_publications slot where slot.kind='marquee' and slot.status='published' and slot.is_paid and slot.deleted_at is null
    and slot.published_at<=clock_timestamp() and slot.expires_at>clock_timestamp())>=5 then
    raise exception using errcode='PSQ01',message='Service waiting for an advertising slot';
   end if;
  end if;
  -- Recheck after the capacity wait; phone/profile/refund eligibility cannot be assumed from discovery.
  if not app.service_payment_eligible(purchase.id) then raise exception using errcode='PSV01',message='Service eligibility changed';end if;
  started:=clock_timestamp();new.published_at:=started;
  new.expires_at:=case kind when 'fair' then terms.fair_ends_at else started+purchase.duration_days*interval '24 hours' end;
  if new.expires_at<=started then raise exception using errcode='PSV01',message='Service period ended';end if;
  update app.service_publications set status='published',is_paid=true,published_at=new.published_at,expires_at=new.expires_at,updated_at=started where id=purchase.target_id;
  return new;
 end $$;
create trigger service_payment_fulfillment_guard before insert on app.payment_fulfillments for each row execute function app.guard_service_payment_fulfillment();
create function app.assert_service_checkout_edit(publication uuid) returns void language plpgsql security definer set search_path=pg_catalog as $$
 begin
  if exists(select 1 from app.payment_checkout_intents i join app.payment_orders o on o.id=i.id
   where i.target_id=publication and i.target_type in ('fair_application','ad_marquee') and
   o.status in ('created','pending','succeeded')) then
   raise exception using errcode='PSF01',message='Resolve service checkout before editing';
  end if;
 end $$;
create function app.guard_service_checkout_edit() returns trigger language plpgsql security definer set search_path=pg_catalog as $$
 begin
  if tg_op='UPDATE' and row(new.form,new.city_id,new.profession_id,new.revision,new.deleted_at,new.author_id,new.id,new.kind)
   is not distinct from row(old.form,old.city_id,old.profession_id,old.revision,old.deleted_at,old.author_id,old.id,old.kind) then return new;end if;
  perform app.assert_service_checkout_edit(old.id);
  if tg_op='DELETE' then return old;end if;return new;
 end $$;
create trigger service_checkout_edit_guard before update or delete on app.service_publications for each row execute function app.guard_service_checkout_edit();
create function app.guard_service_checkout_photo_edit() returns trigger language plpgsql security definer set search_path=pg_catalog as $$
 declare publication uuid;
 begin
  publication:=case when tg_op='DELETE' then old.publication_id else new.publication_id end;
  perform id from app.users where id=(select author_id from app.service_publications where id=publication) for update;
  perform id from app.service_publications where id=publication for update;
  perform app.assert_service_checkout_edit(publication);
  if tg_op='UPDATE' and old.publication_id<>new.publication_id then
   raise exception using errcode='PSF01',message='Photo reassignment refused';
  end if;
  if tg_op='DELETE' then return old;end if;return new;
 end $$;
create trigger service_checkout_photo_edit_guard before insert or update or delete on app.service_publication_photos for each row execute function app.guard_service_checkout_photo_edit();
revoke all on app.service_payment_terms from public;
revoke all on function app.fair_event_at(timestamptz),app.guard_service_payment_terms(),app.service_payment_eligible(uuid),app.guard_service_payment_fulfillment(),app.assert_service_checkout_edit(uuid),app.guard_service_checkout_edit(),app.guard_service_checkout_photo_edit() from public;

-- Preserve all existing source, receipt, session and refund verification checks.
alter table app.payment_refund_effects drop constraint payment_refund_effects_target_type_check;
alter table app.payment_refund_effects add constraint payment_refund_effects_target_type_check check(target_type in ('listing','vacancy','workRequest','fair_application','ad_marquee'));
create or replace function app.refund_target_admitted(payment_id uuid,operation uuid) returns boolean
 language plpgsql security definer set search_path='' as $$
declare purchase app.payment_checkout_intents;decision app.application_compensation_cases;
begin
 select * into purchase from app.payment_checkout_intents where id=payment_id;
 if not found then return false;end if;
 if purchase.target_type in ('listing','vacancy','workRequest') then
  return purchase.duration_days is not null and
   not exists(select 1 from app.payment_renewals r join app.payment_orders o on o.id=r.intent_id and o.status='succeeded' where r.previous_intent_id=purchase.id) and
   not exists(select 1 from app.payment_orders o where o.owner_id=purchase.owner_id and o.target_type=purchase.target_type and o.target_id=purchase.target_id and o.id<>purchase.id and
    (o.status in ('created','pending') or o.status='succeeded' and not exists(select 1 from app.payment_fulfillments f where f.intent_id=o.id)));
 end if;
 if purchase.target_type in ('fair_application','ad_marquee') then
  return purchase.is_test and ((purchase.target_type='fair_application' and purchase.duration_days is null) or
   (purchase.target_type='ad_marquee' and purchase.duration_days is not null)) and
   exists(select 1 from app.service_payment_terms where intent_id=purchase.id);
 end if;
 if purchase.target_type<>'application' or purchase.duration_days is not null or purchase.is_test is distinct from true or operation is distinct from purchase.id then return false;end if;
 select * into decision from app.application_compensation_cases where payment_intent_id=purchase.id;
 if not found then return false;end if;
 return decision.application_id=purchase.target_id and decision.merchant_shop_id=purchase.merchant_shop_id and
  decision.amount=purchase.amount and decision.policy_version='paid-response-unread-v1' and
  decision.fiscal_mode=app.placement_refund_fiscal_mode(purchase);
end $$;

create or replace function app.guard_placement_refund_approval() returns trigger
 language plpgsql security definer set search_path='' as $$
declare session_hash text;actor uuid;version bigint;payer uuid;purchase app.payment_checkout_intents;order_status text;mode text;captured text;capture_key text;
begin
 if tg_op<>'INSERT' then raise exception 'Refund approval is immutable' using errcode='42501';end if;
 if pg_catalog.current_setting('transaction_isolation')<>'read committed' then raise exception 'Refund approval requires read committed' using errcode='23514';end if;
 session_hash:=pg_catalog.current_setting('blizhniy.refund_approval_session',true);
 if session_hash is null or session_hash !~ '^[a-f0-9]{64}$' then raise exception 'Administrator session required' using errcode='42501';end if;
 select user_id into actor from app.sessions where token_hash=session_hash;
 select auth_version into version from app.users where id=actor and role='admin' and not is_blocked and email_verified_at is not null for update;
 if not found then raise exception 'Administrator session required' using errcode='42501';end if;
 perform token_hash from app.sessions where token_hash=session_hash and user_id=actor and auth_version=version and scope='app'
  and expires_at>pg_catalog.clock_timestamp() and last_seen_at>pg_catalog.clock_timestamp()-interval '30 minutes' for update;
 if not found then raise exception 'Administrator session required' using errcode='42501';end if;
 select owner_id into payer from app.payment_checkout_intents where id=new.payment_intent_id;
 if payer is null then raise exception 'Refund purchase unavailable' using errcode='23514';end if;
 -- Administrator is already locked. Never wait on a second user's auth lock.
 perform id from app.users where id=payer for update nowait;
 select * into purchase from app.payment_checkout_intents where id=new.payment_intent_id for update;
 select status into order_status from app.payment_orders where id=new.payment_intent_id for update;
 if order_status is distinct from 'succeeded' or purchase.is_test is distinct from true or
  not (purchase.target_type in ('listing','vacancy','workRequest') and purchase.duration_days is not null or
   purchase.target_type in ('fair_application','ad_marquee') and app.refund_target_admitted(purchase.id,new.id)) or
  purchase.request_sha256 is distinct from pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(purchase.request_body,'UTF8')),'hex') or
  not exists(select 1 from app.payment_verifications v join app.payment_provider_links l
   on l.intent_id=v.intent_id and l.provider_payment_id=v.provider_payment_id
   where v.intent_id=purchase.id and v.status='succeeded' and v.captured_at is not null) then
  raise exception 'Original captured TEST placement required' using errcode='23514';
 end if;
 select captured_at into captured from app.payment_verifications where intent_id=purchase.id and status='succeeded';
 capture_key:=pg_catalog.left(captured,19)||'.'||pg_catalog.rpad(coalesce(pg_catalog.substring(captured,'[.]([0-9]+)Z$'),''),9,'0')||'Z';
 if capture_key collate "C" > (pg_catalog.to_char((pg_catalog.clock_timestamp()+interval '5 minutes') at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US')||'000Z') collate "C" then
  raise exception 'Refund capture chronology requires reconciliation' using errcode='23514';
 end if;
 if new.reason is null or new.reason<>pg_catalog.btrim(new.reason,U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF') or pg_catalog.char_length(new.reason) not between 1 and 500 or
  new.reason ~ '[[:cntrl:]]' or new.reason ~ U&'[\061C\200E\200F\202A-\202E\2066-\2069]' or
  app.refund_utf16_length(new.reason)>500 or
  new.reason ~* '<[[:space:]]*(/?[a-z][^<>]*|![^<>]*|[?][^<>]*)>' then
  raise exception 'Refund reason required' using errcode='23514';
 end if;
 mode:=app.placement_refund_fiscal_mode(purchase);
 -- Locks on financial rows may outlive the session. Recheck wall clock after them.
 perform token_hash from app.sessions where token_hash=session_hash and user_id=actor and auth_version=version and scope='app'
  and expires_at>pg_catalog.clock_timestamp() and last_seen_at>pg_catalog.clock_timestamp()-interval '30 minutes';
 if not found then raise exception 'Administrator session expired' using errcode='42501';end if;
 new.approved_by:=actor;new.policy_version:='placement-full-admin-v1';new.fiscal_mode:=mode;new.amount:=purchase.amount;new.approved_at:=pg_catalog.clock_timestamp();
 return new;
end;
$$;

create or replace function app.guard_placement_refund_reservation() returns trigger
 language plpgsql set search_path='' as $$
declare purchase app.payment_checkout_intents%rowtype;
 target_allowed boolean;
begin
 if tg_op<>'INSERT' then
  raise exception using errcode='23514',message='Refund reservation history is immutable';
 end if;
 if pg_catalog.current_setting('transaction_isolation')<>'read committed' then
  raise exception using errcode='PBR02',message='Refund reservation requires read committed';
 end if;
 -- Match financial writers: intent -> order. No target/user locks acquired here.
 select * into purchase from app.payment_checkout_intents where id=new.payment_intent_id for update;
 if not found then raise exception using errcode='23514',message='Refund purchase is unavailable';end if;
 -- Separate statements preserve legacy callers without EXECUTE on the new helper.
 if purchase.target_type in ('application','fair_application','ad_marquee') then target_allowed:=app.refund_target_admitted(purchase.id,new.id);
 else target_allowed:=purchase.target_type in ('listing','vacancy','workRequest') and purchase.duration_days is not null;end if;
 perform id from app.payment_orders where id=new.payment_intent_id and status='succeeded' for update;
 if not found or target_allowed is distinct from true or
  purchase.is_test is distinct from true or new.is_test is distinct from true or
  new.merchant_shop_id is distinct from purchase.merchant_shop_id or new.amount is distinct from purchase.amount or
  purchase.request_sha256 is distinct from pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(purchase.request_body,'UTF8')),'hex') or
  not exists(select 1 from app.payment_verifications v where v.intent_id=new.payment_intent_id and
   v.provider_payment_id=new.provider_payment_id and v.status='succeeded' and v.captured_at is not null) then
  raise exception using errcode='23514',message='Refund requires the original captured TEST placement';
 end if;
 new.created_at:=pg_catalog.clock_timestamp();return new;
end $$;

create or replace function app.guard_refund_request_history() returns trigger
 language plpgsql set search_path='' as $$
declare
 reservation app.payment_refund_reservations%rowtype;
 purchase app.payment_checkout_intents%rowtype;
 stored app.payment_refund_requests%rowtype;
 expected_body text;
 expected_key text;
 target_allowed boolean;
begin
 if tg_op<>'INSERT' then
  raise exception using errcode='23514',message='Refund request history is immutable';
 end if;
 if pg_catalog.current_setting('transaction_isolation')<>'read committed' then
  raise exception using errcode='PBR02',message='Refund request requires read committed';
 end if;
 select * into reservation from app.payment_refund_reservations where id=new.operation_id;
 if not found then raise exception using errcode='23514',message='Refund reservation is unavailable';end if;
 select * into purchase from app.payment_checkout_intents where id=reservation.payment_intent_id for update;
 if not found then raise exception using errcode='23514',message='Refund purchase is unavailable';end if;
 -- Separate statements preserve legacy callers without EXECUTE on the new helper.
 if purchase.target_type in ('application','fair_application','ad_marquee') then target_allowed:=app.refund_target_admitted(purchase.id,reservation.id);
 else target_allowed:=purchase.target_type in ('listing','vacancy','workRequest') and purchase.duration_days is not null;end if;
 perform id from app.payment_orders where id=reservation.payment_intent_id and status='succeeded' for update;
 if not found or target_allowed is distinct from true or
  purchase.is_test is distinct from true or reservation.is_test is distinct from true or
  reservation.merchant_shop_id is distinct from purchase.merchant_shop_id or reservation.amount is distinct from purchase.amount or
  purchase.request_sha256 is distinct from pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(purchase.request_body,'UTF8')),'hex') then
  raise exception using errcode='23514',message='Refund requires the original captured TEST placement';
 end if;
 -- Fresh query after lock waits; provider links and successful verification are immutable.
 if not exists(select 1 from app.payment_provider_links l join app.payment_verifications v
  on v.intent_id=l.intent_id and v.provider_payment_id=l.provider_payment_id
  where l.intent_id=reservation.payment_intent_id and l.provider_payment_id=reservation.provider_payment_id
   and v.status='succeeded' and v.captured_at is not null) then
  raise exception using errcode='23514',message='Refund capture binding is unavailable';
 end if;
 expected_key:='refund-'||reservation.id::text;
 -- All substitutions are canonical UUID/numeric values, never arbitrary strings.
 expected_body:=pg_catalog.format('{"payment_id":"%s","amount":{"value":"%s","currency":"RUB"},"metadata":{"localRefundId":"%s","localPaymentId":"%s"}}',
  reservation.provider_payment_id,reservation.amount::text,reservation.id,reservation.payment_intent_id);
 if tg_relid='app.payment_refund_requests'::regclass then
  if new.idempotence_key is distinct from expected_key or new.request_body is distinct from expected_body then
   raise exception using errcode='23514',message='Refund request bytes do not match the original reservation';
  end if;
  new.request_sha256:=pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(new.request_body,'UTF8')),'hex');
  new.created_at:=pg_catalog.clock_timestamp();
 else
  select * into stored from app.payment_refund_requests where operation_id=reservation.id;
  if not found or stored.idempotence_key is distinct from expected_key or stored.request_body is distinct from expected_body or
   stored.request_sha256 is distinct from pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(stored.request_body,'UTF8')),'hex') then
   raise exception using errcode='23514',message='Refund preparation is unavailable';
  end if;
  new.authorized_at:=pg_catalog.clock_timestamp();
 end if;
 return new;
end $$;

create or replace function app.guard_refund_journal() returns trigger
 language plpgsql set search_path='' as $$
declare
 reservation app.payment_refund_reservations%rowtype;
 purchase app.payment_checkout_intents%rowtype;
 prepared app.payment_refund_requests%rowtype;
 captured text;
 previous app.payment_refund_observations%rowtype;
 created_key text;
 capture_key text;
 previous_key text;
 future_key text;
 expected_body text;
 target_allowed boolean;
begin
 if tg_op<>'INSERT' then raise exception using errcode='23514',message='Refund journal is immutable';end if;
 if pg_catalog.current_setting('transaction_isolation')<>'read committed' then
  raise exception using errcode='PBR02',message='Refund journal requires read committed';
 end if;
 select * into reservation from app.payment_refund_reservations where id=new.operation_id;
 if not found then raise exception using errcode='23514',message='Refund reservation is unavailable';end if;
 select * into purchase from app.payment_checkout_intents where id=reservation.payment_intent_id for update;
 if not found then raise exception using errcode='23514',message='Refund purchase is unavailable';end if;
 -- Separate statements preserve legacy callers without EXECUTE on the new helper.
 if purchase.target_type in ('application','fair_application','ad_marquee') then target_allowed:=app.refund_target_admitted(purchase.id,reservation.id);
 else target_allowed:=purchase.target_type in ('listing','vacancy','workRequest') and purchase.duration_days is not null;end if;
 perform id from app.payment_orders where id=purchase.id and status in ('succeeded','refunded') for update;
 if not found then raise exception using errcode='23514',message='Refund requires the original captured purchase';end if;
 -- Fresh statements after waits see the latest committed source/history.
 select * into reservation from app.payment_refund_reservations where id=new.operation_id;
 select q.* into prepared from app.payment_refund_requests q join app.payment_refund_dispatch_anchors a on a.operation_id=q.operation_id
  where q.operation_id=new.operation_id;
 if not found or target_allowed is distinct from true or
  purchase.is_test is distinct from true or reservation.is_test is distinct from true or
  reservation.amount is distinct from purchase.amount or reservation.merchant_shop_id is distinct from purchase.merchant_shop_id or
  purchase.request_sha256 is distinct from pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(purchase.request_body,'UTF8')),'hex') then
  raise exception using errcode='23514',message='Refund requires an original prepared TEST placement';
 end if;
 select v.captured_at into captured from app.payment_verifications v join app.payment_provider_links l
  on l.intent_id=v.intent_id and l.provider_payment_id=v.provider_payment_id
  where l.intent_id=purchase.id and l.provider_payment_id=reservation.provider_payment_id and v.status='succeeded' and v.captured_at is not null;
 if not found then raise exception using errcode='23514',message='Refund capture binding is unavailable';end if;
 expected_body:=pg_catalog.format('{"payment_id":"%s","amount":{"value":"%s","currency":"RUB"},"metadata":{"localRefundId":"%s","localPaymentId":"%s"}}',
  reservation.provider_payment_id,reservation.amount::text,reservation.id,reservation.payment_intent_id);
 if prepared.idempotence_key is distinct from 'refund-'||reservation.id::text or prepared.request_body is distinct from expected_body or
  prepared.request_sha256 is distinct from pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(prepared.request_body,'UTF8')),'hex') then
  raise exception using errcode='23514',message='Refund request binding is unavailable';
 end if;
 if tg_relid='app.payment_refund_provider_links'::regclass then
  new.created_at:=pg_catalog.clock_timestamp();return new;
 end if;
 if not exists(select 1 from app.payment_refund_provider_links where operation_id=new.operation_id and provider_refund_id=new.provider_refund_id) then
  raise exception using errcode='23514',message='Refund provider identity does not match';
 end if;
 if new.status is null or new.status not in ('pending','succeeded','canceled') or new.provider_created_at is null or
  pg_catalog.char_length(new.provider_created_at)>30 or
  new.provider_created_at !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,9})?Z$' then
  raise exception using errcode='23514',message='Refund observation is invalid';
 end if;
 begin
  if pg_catalog.to_char((pg_catalog.left(new.provider_created_at,19)||'Z')::timestamptz at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS')<>pg_catalog.left(new.provider_created_at,19) then
   raise exception using errcode='23514',message='Refund calendar date is invalid';
  end if;
 exception when invalid_datetime_format or datetime_field_overflow then
  raise exception using errcode='23514',message='Refund calendar date is invalid';
 end;
 -- PostgreSQL timestamps round to microseconds. Compare padded UTC text keys
 -- instead so a one-nanosecond reversal or changed identity is not lost.
 created_key:=pg_catalog.left(new.provider_created_at,19)||'.'||pg_catalog.rpad(coalesce(pg_catalog.substring(new.provider_created_at,'[.]([0-9]+)Z$'),''),9,'0')||'Z';
 capture_key:=pg_catalog.left(captured,19)||'.'||pg_catalog.rpad(coalesce(pg_catalog.substring(captured,'[.]([0-9]+)Z$'),''),9,'0')||'Z';
 future_key:=pg_catalog.to_char((pg_catalog.clock_timestamp()+interval '5 minutes') at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US')||'000Z';
 if created_key collate "C" < capture_key collate "C" or created_key collate "C" > future_key collate "C" then
  raise exception using errcode='23514',message='Refund creation time requires reconciliation';
 end if;
 for previous in select * from app.payment_refund_observations where operation_id=new.operation_id loop
  previous_key:=pg_catalog.left(previous.provider_created_at,19)||'.'||pg_catalog.rpad(coalesce(pg_catalog.substring(previous.provider_created_at,'[.]([0-9]+)Z$'),''),9,'0')||'Z';
  if previous.provider_refund_id is distinct from new.provider_refund_id or previous_key is distinct from created_key or
   (previous.status<>'pending' and previous.status<>new.status) then
   raise exception using errcode='23514',message='Refund observation contradicts recorded history';
  end if;
 end loop;
 new.observed_at:=pg_catalog.clock_timestamp();return new;
end $$;

create or replace function app.guard_refund_dispatch() returns trigger language plpgsql set search_path='' as $$
declare
 reservation app.payment_refund_reservations%rowtype;
 purchase app.payment_checkout_intents%rowtype;
 prepared app.payment_refund_requests%rowtype;
 original_status text;
 anchor timestamptz;
 target_allowed boolean;
begin
 if tg_op<>'INSERT' then raise exception using errcode='23514',message='Refund send history is immutable';end if;
 if pg_catalog.current_setting('transaction_isolation')<>'read committed' then
  raise exception using errcode='PBR02',message='Refund send history requires read committed';
 end if;
 select * into reservation from app.payment_refund_reservations where id=new.operation_id;
 if not found then raise exception using errcode='23514',message='Refund reservation is unavailable';end if;
 select * into purchase from app.payment_checkout_intents where id=reservation.payment_intent_id for update;
 if not found then raise exception using errcode='23514',message='Refund purchase is unavailable';end if;
 -- Separate statements preserve legacy callers without EXECUTE on the new helper.
 if purchase.target_type in ('application','fair_application','ad_marquee') then target_allowed:=app.refund_target_admitted(purchase.id,reservation.id);
 else target_allowed:=purchase.target_type in ('listing','vacancy','workRequest') and purchase.duration_days is not null;end if;
 select status into original_status from app.payment_orders where id=purchase.id for update;
 if not found or original_status not in ('succeeded','refunded') then
  raise exception using errcode='23514',message='Refund requires the original captured purchase';
 end if;
 select * into reservation from app.payment_refund_reservations where id=new.operation_id;
 select q.* into prepared from app.payment_refund_requests q where q.operation_id=new.operation_id;
 if not found or reservation.payment_intent_id is distinct from purchase.id or target_allowed is distinct from true or purchase.is_test is distinct from true or reservation.is_test is distinct from true or
  reservation.amount is distinct from purchase.amount or reservation.merchant_shop_id is distinct from purchase.merchant_shop_id or
  purchase.request_sha256 is distinct from pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(purchase.request_body,'UTF8')),'hex') or
  prepared.request_sha256 is distinct from pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(prepared.request_body,'UTF8')),'hex') or
  prepared.idempotence_key is distinct from 'refund-'||reservation.id::text or prepared.request_body is distinct from
   pg_catalog.format('{"payment_id":"%s","amount":{"value":"%s","currency":"RUB"},"metadata":{"localRefundId":"%s","localPaymentId":"%s"}}',
    reservation.provider_payment_id,reservation.amount::text,reservation.id,reservation.payment_intent_id) then
  raise exception using errcode='23514',message='Refund send source is unavailable';
 end if;
 if not exists(select 1 from app.payment_provider_links l join app.payment_verifications v
  on v.intent_id=l.intent_id and v.provider_payment_id=l.provider_payment_id where l.intent_id=purchase.id and
   l.provider_payment_id=reservation.provider_payment_id and v.status='succeeded' and v.captured_at is not null) then
  raise exception using errcode='23514',message='Refund capture binding is unavailable';
 end if;
 select authorized_at into anchor from app.payment_refund_dispatch_anchors where operation_id=new.operation_id;
 if not found then raise exception using errcode='23514',message='Refund original window is unavailable';end if;
 if tg_relid='app.payment_refund_send_attempts'::regclass then
  if original_status<>'succeeded' or pg_catalog.clock_timestamp()>=anchor+interval '23 hours 55 minutes' or
   exists(select 1 from app.payment_refund_candidates where operation_id=new.operation_id) or
   exists(select 1 from app.payment_refund_provider_links where operation_id=new.operation_id) or
   (select count(*) from app.payment_refund_send_attempts where operation_id=new.operation_id)>=12 then
   raise exception using errcode='23514',message='Refund requires readback or operator reconciliation';
  end if;
  new.request_sha256:=prepared.request_sha256;new.started_at:=pg_catalog.clock_timestamp();return new;
 end if;
 -- A valid late reply must remain recordable after the send window expires.
 if not exists(select 1 from app.payment_refund_send_attempts where id=new.attempt_id and operation_id=new.operation_id and request_sha256=prepared.request_sha256) then
  raise exception using errcode='23514',message='Refund reply has no original send attempt';
 end if;
 new.received_at:=pg_catalog.clock_timestamp();return new;
end $$;

create or replace function app.apply_placement_refund_effect() returns trigger
 language plpgsql security definer set search_path='' as $$
declare
 reservation app.payment_refund_reservations%rowtype;
 purchase app.payment_checkout_intents%rowtype;
 prepared app.payment_refund_requests%rowtype;
 previous app.payment_refund_effects%rowtype;
 original_receipt app.payment_fulfillments%rowtype;
 renewal app.payment_renewals%rowtype;
 original_status text;
 refund_id uuid;
 captured text;
 refund_created text;
 stamp text;
 captured_key text;
 refunded_key text;
 target record;
 has_target boolean;
 has_receipt boolean;
 result text;
 body jsonb;
 invoice jsonb;
 item jsonb;
begin
 if tg_op<>'INSERT' then raise exception using errcode='23514',message='Refund effect history is immutable';end if;
 if pg_catalog.current_setting('transaction_isolation')<>'read committed' then
  raise exception using errcode='PBR02',message='Refund effects require read committed';
 end if;
 if new.operation_id is null or new.merchant_shop_id is null or new.merchant_shop_id !~ '^[a-zA-Z0-9_-]{1,64}$' or
  new.payment_intent_id is not null or new.provider_refund_id is not null or new.target_type is not null or
  new.target_id is not null or new.effect is not null or new.applied_at is not null then
  raise exception using errcode='23514',message='Refund effect accepts only operation and merchant';
 end if;
 select * into reservation from app.payment_refund_reservations where id=new.operation_id;
 if not found then raise exception using errcode='23514',message='Refund reservation is unavailable';end if;
 -- Match session/fulfillment order. A deleted historical user need not exist.
 perform u.id from app.users u where u.id=(select i.owner_id from app.payment_checkout_intents i where i.id=reservation.payment_intent_id) for update;
 select * into purchase from app.payment_checkout_intents where id=reservation.payment_intent_id for update;
 if not found then raise exception using errcode='23514',message='Refund purchase is unavailable';end if;
 select status into original_status from app.payment_orders where id=purchase.id for update;
 if not found or original_status not in ('succeeded','refunded') then
  raise exception using errcode='23514',message='Refund requires the original captured order';
 end if;
 -- Fresh statements after any lock wait, not a pre-wait snapshot.
 select * into reservation from app.payment_refund_reservations where id=new.operation_id;
 select q.* into prepared from app.payment_refund_requests q join app.payment_refund_dispatch_anchors a on a.operation_id=q.operation_id
  where q.operation_id=new.operation_id;
 if not found or reservation.payment_intent_id is distinct from purchase.id or
  not (purchase.target_type in ('listing','vacancy','workRequest') and purchase.duration_days is not null or
   purchase.target_type in ('fair_application','ad_marquee') and app.refund_target_admitted(purchase.id,new.operation_id)) or
  purchase.is_test is distinct from true or reservation.is_test is distinct from true or
  purchase.merchant_shop_id is distinct from new.merchant_shop_id or reservation.merchant_shop_id is distinct from purchase.merchant_shop_id or
  reservation.amount is distinct from purchase.amount or
  purchase.request_sha256 is distinct from pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(purchase.request_body,'UTF8')),'hex') or
  prepared.request_sha256 is distinct from pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(prepared.request_body,'UTF8')),'hex') or
  prepared.idempotence_key is distinct from 'refund-'||reservation.id::text or prepared.request_body is distinct from
   pg_catalog.format('{"payment_id":"%s","amount":{"value":"%s","currency":"RUB"},"metadata":{"localRefundId":"%s","localPaymentId":"%s"}}',
    reservation.provider_payment_id,reservation.amount::text,reservation.id,reservation.payment_intent_id) then
  raise exception using errcode='23514',message='Refund original TEST binding is unavailable';
 end if;
 -- A coherent checksum alone does not make a malformed historical request valid.
 -- Validate the consumed original schema as well as its immutable bindings.
 body:=purchase.request_body::jsonb;
 if pg_catalog.jsonb_typeof(body) is distinct from 'object' then
  raise exception using errcode='23514',message='Refund original request shape is invalid';
 end if;
 if not (body ?& array['amount','capture','confirmation','metadata']) or
  exists(select 1 from pg_catalog.jsonb_object_keys(body) k where k not in ('amount','capture','confirmation','metadata','description','receipt')) or
  pg_catalog.jsonb_typeof(body->'amount') is distinct from 'object' or pg_catalog.jsonb_typeof(body->'confirmation') is distinct from 'object' or
  pg_catalog.jsonb_typeof(body->'metadata') is distinct from 'object' then
  raise exception using errcode='23514',message='Refund original request shape is invalid';
 end if;
 if (select count(*) from pg_catalog.jsonb_object_keys(body->'amount'))<>2 or body->'amount'->>'value' is distinct from purchase.amount::text or
  body->'amount'->>'currency' is distinct from 'RUB' or pg_catalog.jsonb_typeof(body->'amount'->'value') is distinct from 'string' or
  body->'capture' is distinct from 'true'::jsonb or
  (select count(*) from pg_catalog.jsonb_object_keys(body->'confirmation'))<>2 or body->'confirmation'->>'type' is distinct from 'redirect' or
  pg_catalog.jsonb_typeof(body->'confirmation'->'return_url') is distinct from 'string' or
  pg_catalog.char_length(body->'confirmation'->>'return_url') not between 1 and 2048 or
  (select count(*) from pg_catalog.jsonb_object_keys(body->'metadata'))<>4 or
  pg_catalog.jsonb_typeof(body->'metadata'->'localPaymentId') is distinct from 'string' or pg_catalog.jsonb_typeof(body->'metadata'->'targetId') is distinct from 'string' or
  pg_catalog.jsonb_typeof(body->'metadata'->'targetType') is distinct from 'string' or pg_catalog.jsonb_typeof(body->'metadata'->'tariffId') is distinct from 'string' or
  body->'metadata'->>'localPaymentId' is distinct from purchase.id::text or body->'metadata'->>'targetId' is distinct from purchase.target_id::text or
  body->'metadata'->>'targetType' is distinct from purchase.target_type or body->'metadata'->>'tariffId' is distinct from purchase.tariff_id or
  (body ? 'description' and (pg_catalog.jsonb_typeof(body->'description') is distinct from 'string' or
   pg_catalog.char_length(body->>'description')>128 or body->>'description' ~ '[[:cntrl:]]')) then
  raise exception using errcode='23514',message='Refund original request binding is invalid';
 end if;
 if body ? 'receipt' then
  invoice:=body->'receipt';
  if pg_catalog.jsonb_typeof(invoice) is distinct from 'object' then
   raise exception using errcode='23514',message='Refund original receipt is invalid';
  end if;
  if (select count(*) from pg_catalog.jsonb_object_keys(invoice))<>3 or not (invoice ?& array['customer','internet','items']) or
   pg_catalog.jsonb_typeof(invoice->'customer') is distinct from 'object' or invoice->'internet' is distinct from 'true'::jsonb or
   pg_catalog.jsonb_typeof(invoice->'items') is distinct from 'array' then
   raise exception using errcode='23514',message='Refund original receipt is invalid';
  end if;
  if (select count(*) from pg_catalog.jsonb_object_keys(invoice->'customer'))<>1 or
   pg_catalog.jsonb_typeof(invoice->'customer'->'email') is distinct from 'string' or
   pg_catalog.char_length(invoice->'customer'->>'email')>254 or invoice->'customer'->>'email' !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' or
   invoice->'customer'->>'email' ~ '[[:cntrl:]]' or pg_catalog.jsonb_array_length(invoice->'items')<>1 then
   raise exception using errcode='23514',message='Refund original receipt is invalid';
  end if;
  item:=invoice->'items'->0;
  if pg_catalog.jsonb_typeof(item) is distinct from 'object' then raise exception using errcode='23514',message='Refund original receipt item is invalid';end if;
  if (select count(*) from pg_catalog.jsonb_object_keys(item))<>6 or not (item ?& array['amount','description','payment_mode','payment_subject','quantity','vat_code']) or
   pg_catalog.jsonb_typeof(item->'amount') is distinct from 'object' or pg_catalog.jsonb_typeof(item->'vat_code') is distinct from 'number' then
   raise exception using errcode='23514',message='Refund original receipt item is invalid';
  end if;
  if (select count(*) from pg_catalog.jsonb_object_keys(item->'amount'))<>2 or pg_catalog.jsonb_typeof(item->'amount'->'value') is distinct from 'string' or
   item->'amount'->>'value' is distinct from purchase.amount::text or item->'amount'->>'currency' is distinct from 'RUB' or
   pg_catalog.jsonb_typeof(item->'description') is distinct from 'string' or pg_catalog.char_length(item->>'description') not between 1 and 128 or
   item->>'description' ~ '[[:cntrl:]]' or item->>'payment_mode' is distinct from 'full_payment' or item->>'payment_subject' is distinct from 'service' or
   item->'quantity' is distinct from '1'::jsonb or (item->>'vat_code')::numeric not between 1 and 12 or
   (item->>'vat_code')::numeric<>pg_catalog.trunc((item->>'vat_code')::numeric) then
   raise exception using errcode='23514',message='Refund original receipt item is invalid';
  end if;
 end if;
 select v.captured_at into captured from app.payment_verifications v join app.payment_provider_links l
  on l.intent_id=v.intent_id and l.provider_payment_id=v.provider_payment_id
  where l.intent_id=purchase.id and l.provider_payment_id=reservation.provider_payment_id and v.status='succeeded' and v.captured_at is not null;
 if not found then raise exception using errcode='23514',message='Refund capture proof is unavailable';end if;
 select l.provider_refund_id,o.provider_created_at into refund_id,refund_created from app.payment_refund_provider_links l
  join app.payment_refund_observations o on o.operation_id=l.operation_id and o.provider_refund_id=l.provider_refund_id
  where l.operation_id=new.operation_id and o.status='succeeded';
 if not found or exists(select 1 from app.payment_refund_observations where operation_id=new.operation_id and status='canceled') or
  exists(select 1 from app.payment_refund_candidates where operation_id=new.operation_id and provider_refund_id<>refund_id) then
  raise exception using errcode='23514',message='Refund requires authoritative successful verification';
 end if;
 foreach stamp in array array[captured,refund_created] loop
  if stamp is null or pg_catalog.char_length(stamp)>30 or stamp !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,9})?Z$' then
   raise exception using errcode='23514',message='Refund chronology requires reconciliation';
  end if;
  begin
   if pg_catalog.to_char((pg_catalog.left(stamp,19)||'Z')::timestamptz at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS')<>pg_catalog.left(stamp,19) then
    raise exception using errcode='23514',message='Refund calendar date is invalid';
   end if;
  exception when invalid_datetime_format or datetime_field_overflow then
   raise exception using errcode='23514',message='Refund calendar date is invalid';
  end;
 end loop;
 captured_key:=pg_catalog.left(captured,19)||'.'||pg_catalog.rpad(coalesce(pg_catalog.substring(captured,'[.]([0-9]+)Z$'),''),9,'0')||'Z';
 refunded_key:=pg_catalog.left(refund_created,19)||'.'||pg_catalog.rpad(coalesce(pg_catalog.substring(refund_created,'[.]([0-9]+)Z$'),''),9,'0')||'Z';
 if refunded_key collate "C" < captured_key collate "C" or refunded_key collate "C" >
  (pg_catalog.to_char((pg_catalog.clock_timestamp()+interval '5 minutes') at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US')||'000Z') collate "C" then
  raise exception using errcode='23514',message='Refund chronology requires reconciliation';
 end if;
 select * into previous from app.payment_refund_effects where operation_id=new.operation_id;
 if found then
  if previous.payment_intent_id is distinct from purchase.id or previous.provider_refund_id is distinct from refund_id or
   previous.merchant_shop_id is distinct from purchase.merchant_shop_id or previous.target_type is distinct from purchase.target_type or
   previous.target_id is distinct from purchase.target_id or original_status<>'refunded' then
   raise exception using errcode='23514',message='Refund effect contradicts recorded history';
  end if;
  return previous;
 end if;
 select * into original_receipt from app.payment_fulfillments where intent_id=purchase.id;
 has_receipt:=found;
 result:='unfulfilled';
 if has_receipt then
  -- Lock by ID first; owner/kind drift never grants authority over another card.
  if purchase.target_type='listing' then
   select id,author_id,'listing'::text as kind,status,is_paid,published_at,expires_at into target from app.listings where id=purchase.target_id for update;
  elsif purchase.target_type in ('fair_application','ad_marquee') then
   select id,author_id,case kind when 'fair' then 'fair_application' when 'marquee' then 'ad_marquee' end as kind,status,is_paid,published_at,expires_at
    into target from app.service_publications where id=purchase.target_id for update;
  else
   select id,author_id,kind,status,is_paid,published_at,expires_at into target from app.work_publications where id=purchase.target_id for update;
  end if;
  has_target:=found;
  if not has_target or target.author_id is distinct from purchase.owner_id or target.kind is distinct from purchase.target_type then
   result:='missing';
  elsif target.published_at is distinct from original_receipt.published_at or target.expires_at is distinct from original_receipt.expires_at or
   exists(select 1 from app.payment_checkout_intents i join app.payment_orders o on o.id=i.id join app.payment_fulfillments f on f.intent_id=i.id
    where i.id<>purchase.id and i.owner_id=purchase.owner_id and i.target_type=purchase.target_type and i.target_id=purchase.target_id and o.status='succeeded'
     and f.published_at=target.published_at and f.expires_at=target.expires_at) then
   result:='superseded';
  else
   if exists(select 1 from app.payment_orders o where o.id<>purchase.id and o.owner_id=purchase.owner_id and o.target_type=purchase.target_type and o.target_id=purchase.target_id and (o.status in ('created','pending') or o.status='succeeded' and not exists(select 1 from app.payment_fulfillments f where f.intent_id=o.id))) then
    raise exception using errcode='23514',message='Refund target has an unresolved replacement checkout';
   end if;
   result:='revoked';
  end if;
 end if;
 if not app.refund_target_admitted(purchase.id,new.operation_id) then
  raise exception using errcode='PRN01',message='Refund the latest purchase first and resolve any checkout';
 end if;
 update app.payment_orders set status='refunded' where id=purchase.id and status='succeeded';
 if result='revoked' then
  select * into renewal from app.payment_renewals where intent_id=purchase.id;
  if found then
   if not exists(select 1 from app.payment_orders where id=renewal.previous_intent_id and status='succeeded') then
    raise exception using errcode='PRN01',message='Previous paid period is unavailable';
   end if;
   if purchase.target_type='listing' then
    update app.listings set is_paid=true,published_at=renewal.previous_published_at,expires_at=renewal.previous_expires_at,
     status=case when status in ('published','paid') and renewal.previous_expires_at<=pg_catalog.clock_timestamp() then 'archived' else status end,
     updated_at=pg_catalog.clock_timestamp() where id=purchase.target_id;
   else
    update app.work_publications set is_paid=true,published_at=renewal.previous_published_at,expires_at=renewal.previous_expires_at,
     status=case when status in ('published','paid') and renewal.previous_expires_at<=pg_catalog.clock_timestamp() then 'archived' else status end,
     updated_at=pg_catalog.clock_timestamp() where id=purchase.target_id;
   end if;
  elsif purchase.target_type='listing' then
   update app.listings set is_paid=false,status=case when status in ('published','paid') then 'archived' else status end,updated_at=pg_catalog.clock_timestamp() where id=purchase.target_id;
  elsif purchase.target_type in ('fair_application','ad_marquee') then
   update app.service_publications set is_paid=false,status=case when status in ('published','paid') then 'archived' else status end,updated_at=pg_catalog.clock_timestamp() where id=purchase.target_id;
  else
   update app.work_publications set is_paid=false,status=case when status in ('published','paid') then 'archived' else status end,updated_at=pg_catalog.clock_timestamp() where id=purchase.target_id;
  end if;
 end if;
 new.payment_intent_id:=purchase.id;new.provider_refund_id:=refund_id;new.target_type:=purchase.target_type;
 new.target_id:=purchase.target_id;new.effect:=result;new.applied_at:=pg_catalog.clock_timestamp();
 return new;
end $$;

create or replace function app.notify_placement_refund() returns trigger
 language plpgsql security definer set search_path='' as $$
begin
 -- Missing historical payers must not make an otherwise valid financial effect fail.
 insert into app.notifications(user_id,event_key,category,tone,title,body,action_href)
  select p.owner_id,'placement_refund:'||p.id::text,'payment','success','Возврат платы за размещение',
   'Плата за размещение возвращена.'||case when a.id is not null then ' Причина: '||a.reason else '' end,
   case p.target_type when 'listing' then '/cabinet/obyavleniya' when 'vacancy' then '/cabinet/vakansii' when 'fair_application' then '/cabinet/fair-applications' when 'ad_marquee' then '/cabinet/oplata' else '/cabinet/zakazy' end
  from app.payment_checkout_intents p join app.users u on u.id=p.owner_id left join app.payment_refund_approvals a on a.id=new.operation_id and a.payment_intent_id=p.id
  where p.id=new.payment_intent_id on conflict(user_id,event_key) do nothing;
 return new;
end $$;
create or replace function app.fence_refunded_payment_fulfillment() returns trigger
 language plpgsql security definer set search_path='' as $$
begin
 if pg_catalog.current_setting('transaction_isolation')<>'read committed' then
  raise exception using errcode='PBR02',message='Refund fulfillment fence requires read committed';
 end if;
 if exists(select 1 from app.payment_checkout_intents where id=new.intent_id and target_type in ('fair_application','ad_marquee')) then
  perform id from app.users where id=(select owner_id from app.payment_checkout_intents where id=new.intent_id) for update;
 end if;
 perform id from app.payment_checkout_intents where id=new.intent_id for update;
 perform id from app.payment_orders where id=new.intent_id for update;
 -- Separate VOLATILE query sees the reservation committed during a lock wait.
 if exists(select 1 from app.payment_refund_reservations r where r.payment_intent_id=new.intent_id and
  not (exists(select 1 from app.payment_checkout_intents where id=new.intent_id and target_type in ('fair_application','ad_marquee')) and
   exists(select 1 from app.payment_refund_observations outcome where outcome.operation_id=r.id and outcome.status='canceled'))) then
  raise exception using errcode='PBR01',message='Refund reservation prevents new fulfillment';
 end if;
 return new;
end $$;
alter table app.payment_checkout_cancellations drop constraint payment_checkout_cancellations_target_type_check;
alter table app.payment_checkout_cancellations add constraint payment_checkout_cancellations_target_type_check check(target_type in ('listing','vacancy','workRequest','application','fair_application','ad_marquee'));
create or replace function app.guard_checkout_cancellation() returns trigger
 language plpgsql volatile security definer set search_path='' as $$
declare session_hash text;actor uuid;version bigint;purchase app.payment_checkout_intents;checkout app.payment_orders;previous app.payment_checkout_cancellations;
begin
 if tg_op<>'INSERT' then raise exception 'Checkout cancellation history is immutable' using errcode='42501';end if;
 if pg_catalog.current_setting('transaction_isolation')<>'read committed' then raise exception 'Cancellation requires read committed' using errcode='PCA04';end if;
 session_hash:=pg_catalog.current_setting('blizhniy.checkout_cancel_session',true);
 if session_hash is null or session_hash !~ '^[a-f0-9]{64}$' then raise exception 'Owner session required' using errcode='PCA03';end if;
 select user_id into actor from app.sessions where token_hash=session_hash;
 select auth_version into version from app.users where id=actor and not is_blocked and email_verified_at is not null for update;
 if not found then raise exception 'Owner session required' using errcode='PCA03';end if;
 perform token_hash from app.sessions where token_hash=session_hash and user_id=actor and auth_version=version and scope='app'
  and expires_at>pg_catalog.clock_timestamp() and last_seen_at>pg_catalog.clock_timestamp()-interval '30 minutes' for update;
 if not found then raise exception 'Owner session required' using errcode='PCA03';end if;
 select * into purchase from app.payment_checkout_intents where id=new.payment_id for update nowait;
 if not found or purchase.owner_id<>actor or not purchase.is_test or purchase.merchant_shop_id<>'local-fixture-shop'
  or purchase.target_type not in ('listing','vacancy','workRequest','application','fair_application','ad_marquee') then raise exception 'Local checkout required' using errcode='PCA01';end if;
 select * into checkout from app.payment_orders where id=purchase.id for update nowait;
 if not found or row(checkout.owner_id,checkout.target_type,checkout.target_id,checkout.target_revision)
  is distinct from row(purchase.owner_id,purchase.target_type,purchase.target_id,purchase.target_revision) then raise exception 'Local checkout required' using errcode='PCA01';end if;
 select * into previous from app.payment_checkout_cancellations where payment_id=purchase.id;
 if found then new.owner_id:=previous.owner_id;new.target_type:=previous.target_type;new.cancelled_at:=previous.cancelled_at;return new;end if;
 if checkout.status<>'created' or exists(select 1 from app.payment_dispatch_anchors where intent_id=purchase.id) then
  raise exception 'Checkout dispatch may already have started' using errcode='PCA02';end if;
 new.owner_id:=actor;new.target_type:=purchase.target_type;new.cancelled_at:=pg_catalog.clock_timestamp();return new;
end $$;
commit;
