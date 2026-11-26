-- Explicit candidate. Only two unpaid owner draft types and no financial writes.
begin;
set local lock_timeout='3s';
set local statement_timeout='10s';

alter table app.listings drop constraint listings_status_check,
 add constraint listings_status_check check (status in
  ('draft','pending_payment','paid','published','sold','archived','expired','rejected','removed')),
 add constraint listings_removed_unpaid check (status<>'removed' or (not is_paid and published_at is null));

create function app.remove_unpaid_draft(
 session_hash text, expected_owner uuid, target text, draft_id uuid, expected_revision bigint, apply_removal boolean
) returns boolean language plpgsql security definer strict set search_path='' as $$
declare
 actor uuid;
 auth_revision bigint;
 draft record;
 payment_target text;
begin
 if pg_catalog.current_setting('transaction_isolation')<>'read committed'
  or target not in ('listing','marquee') or expected_revision<1 then
  raise exception using errcode='23514',message='Draft removal arguments or isolation refused';
 end if;

 select u.id,u.auth_version into actor,auth_revision
 from app.users u where u.id=(select s.user_id from app.sessions s where s.token_hash=session_hash)
  and not u.is_blocked and u.email_verified_at is not null for update;
 if not found then
  raise exception using errcode='PDR04',message='Owner session required';
 end if;
 perform s.token_hash from app.sessions s where s.token_hash=session_hash and s.user_id=actor
  and s.auth_version=auth_revision and s.scope='app' and s.expires_at>pg_catalog.clock_timestamp()
  and s.last_seen_at>pg_catalog.clock_timestamp()-interval '30 minutes' for update;
 if not found then
  raise exception using errcode='PDR04',message='Owner session required';
 end if;
 if actor<>expected_owner then
  raise exception using errcode='PDR01',message='Own draft required';
 end if;

 -- The same user and target locks protect checkout preparation and form edits.
 if target='listing' then
  payment_target:='listing';
  select l.status,l.revision,l.is_paid,l.published_at,l.status='removed' as removed into draft
  from app.listings l where l.id=draft_id and l.author_id=actor for update;
 else
  payment_target:='ad_marquee';
  select s.status,s.revision,s.is_paid,s.published_at,s.deleted_at is not null as removed into draft
  from app.service_publications s where s.id=draft_id and s.author_id=actor and s.kind='marquee' for update;
 end if;
 if not found or draft.is_paid or draft.published_at is not null
  or draft.status not in ('draft','removed','pending_payment') then
  raise exception using errcode='PDR01',message='Own unpaid draft required';
 end if;
 if draft.revision<>expected_revision then
  raise exception using errcode='PDR02',message='Draft revision changed';
 end if;
 -- A fresh read after the target lock covers checkouts that completed while deletion waited.
 if not draft.removed and (draft.status='pending_payment' or exists(
  select 1 from app.payment_orders o where o.owner_id=actor and o.target_type=payment_target
   and o.target_id=draft_id and o.status in ('created','pending','succeeded'))) then
  raise exception using errcode='PDR03',message='Resolve checkout before removing the draft';
 end if;
 if target='listing' and not draft.removed and exists(
  select 1 from app.listing_blocks b where b.listing_id=draft_id) then
  raise exception using errcode='PDR01',message='Own unpaid draft required';
 end if;

 update app.sessions s set last_seen_at=least(pg_catalog.clock_timestamp(),s.expires_at)
 where s.token_hash=session_hash and s.user_id=actor and s.auth_version=auth_revision
  and s.scope='app' and s.expires_at>pg_catalog.clock_timestamp()
  and s.last_seen_at>pg_catalog.clock_timestamp()-interval '30 minutes';
 if not found then
  raise exception using errcode='PDR04',message='Owner session expired';
 end if;
 if draft.removed or not apply_removal then return draft.removed; end if;

 if target='listing' then
  update app.listings set status='removed',updated_at=pg_catalog.clock_timestamp() where id=draft_id;
 else
  update app.service_publications set deleted_at=pg_catalog.clock_timestamp(),updated_at=pg_catalog.clock_timestamp()
  where id=draft_id;
 end if;
 return true;
end $$;
revoke all on function app.remove_unpaid_draft(text,uuid,text,uuid,bigint,boolean) from public;
commit;
