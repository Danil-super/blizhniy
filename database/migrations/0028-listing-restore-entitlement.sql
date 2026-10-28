-- Follow-up to local0027: historical fulfillment does not authorize restoring a refunded order.
begin;
set local lock_timeout='3s';
set local statement_timeout='10s';
create or replace function app.guard_listing_owner_visibility() returns trigger language plpgsql
set search_path=pg_catalog,app as $$
begin
 if current_user='blizhniy_runtime' and new.status is distinct from old.status then
  if old.status not in ('published','archived') or new.status not in ('published','archived')
   or not old.is_paid or old.published_at is null or old.expires_at is null
   or old.published_at>clock_timestamp() or old.expires_at<=clock_timestamp()
   or new.revision<>old.revision+1
   or (to_jsonb(new)-array['status','revision','updated_at']) is distinct from (to_jsonb(old)-array['status','revision','updated_at'])
   or exists(select 1 from app.listing_blocks b where b.listing_id=old.id)
   or not exists(select 1 from app.payment_checkout_intents i join app.payment_fulfillments f on f.intent_id=i.id
     join app.payment_orders p on p.id=i.id
     where i.target_type='listing' and i.target_id=old.id and i.owner_id=old.author_id
      and f.published_at=old.published_at and f.expires_at=old.expires_at
      and (new.status='archived' or p.status='succeeded'))
  then raise exception 'Listing visibility transition denied' using errcode='42501';end if;
 end if;
 return new;
end;
$$;
revoke all on function app.guard_listing_owner_visibility() from public;
commit;
