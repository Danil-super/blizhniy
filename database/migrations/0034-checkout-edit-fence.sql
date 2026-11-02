-- Local opt-in. Freeze purchased content while payment outcome/fulfillment is
-- unresolved. Existing writers lock user -> target before prepare/edit; this
-- trigger reads the resulting committed order without inverting financial locks.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '10s';
-- Runtime writers cannot read financial tables. Definer authority is restricted
-- to this fixed read-only invariant, not granted to the web role as SQL access.
create function app.guard_checkout_edit() returns trigger
 language plpgsql security definer set search_path='' as $$
declare
 previous jsonb := to_jsonb(old);
 replacement jsonb := to_jsonb(new);
 bookkeeping text[] := array['view_count','updated_at','status','is_paid','published_at','expires_at'];
 target_kind text;
begin
 -- BEFORE triggers do not yet see the computed stored work title. Its source
 -- form is compared in full; ordinary listing titles must remain protected.
 if tg_relid='app.work_publications'::regclass then bookkeeping:=array_append(bookkeeping,'title');end if;
 -- Financial fulfillment must still be able to publish the original version.
 -- Existing grants/financial guards remain responsible for payment authority.
 if (replacement-bookkeeping) is not distinct from (previous-bookkeeping)
  and (new.status is not distinct from old.status or
   (old.status='draft' and not old.is_paid and new.status='published' and new.is_paid)) then
  return new;
 end if;
 -- A pre-wait REPEATABLE READ snapshot could miss a newly prepared order when
 -- its owner/target locks did not update the locked tuple. Refuse that mode.
 if current_setting('transaction_isolation')<>'read committed' then
  raise exception using errcode='PBL02',message='Checkout editing requires read committed';
 end if;
 target_kind := case when tg_relid='app.listings'::regclass then 'listing' else previous->>'kind' end;
 if exists(select 1 from app.payment_orders o
  where o.owner_id=old.author_id and o.target_type=target_kind and o.target_id=old.id
   and (o.status in ('created','pending') or (o.status='succeeded' and
    not exists(select 1 from app.payment_fulfillments f where f.intent_id=o.id)))) then
  raise exception using errcode='PBL01',message='Checkout must be resolved before editing';
 end if;
 return new;
end $$;
create trigger listing_checkout_edit_fence before update on app.listings
 for each row execute function app.guard_checkout_edit();
create trigger work_checkout_edit_fence before update on app.work_publications
 for each row execute function app.guard_checkout_edit();
revoke all on function app.guard_checkout_edit() from public;

-- Cover link edits as well as the parent revision. Existing stores already hold
-- the same parent lock before changing photos; standalone SQL must acquire it.
create function app.guard_checkout_photo_edit() returns trigger
 language plpgsql security definer set search_path='' as $$
declare
 parent_column text;
 affected uuid[];
 target record;
begin
 if tg_op='UPDATE' and new is not distinct from old then return new;end if;
 if current_setting('transaction_isolation')<>'read committed' then
  raise exception using errcode='PBL02',message='Checkout editing requires read committed';
 end if;
 parent_column := case when tg_relid='app.listing_photos'::regclass then 'listing_id' else 'publication_id' end;
 affected := array[(to_jsonb(old)->>parent_column)::uuid,(to_jsonb(new)->>parent_column)::uuid];
 if tg_relid='app.listing_photos'::regclass then
  for target in select l.id,l.author_id,'listing'::text as kind from app.listings l
   where l.id=any(affected) order by l.id for update loop
   if exists(select 1 from app.payment_orders o where o.owner_id=target.author_id
    and o.target_type=target.kind and o.target_id=target.id and (o.status in ('created','pending') or
     (o.status='succeeded' and not exists(select 1 from app.payment_fulfillments f where f.intent_id=o.id)))) then
    raise exception using errcode='PBL01',message='Checkout must be resolved before editing';
   end if;
  end loop;
 else
  for target in select w.id,w.author_id,w.kind from app.work_publications w
   where w.id=any(affected) order by w.id for update loop
   if exists(select 1 from app.payment_orders o where o.owner_id=target.author_id
    and o.target_type=target.kind and o.target_id=target.id and (o.status in ('created','pending') or
     (o.status='succeeded' and not exists(select 1 from app.payment_fulfillments f where f.intent_id=o.id)))) then
    raise exception using errcode='PBL01',message='Checkout must be resolved before editing';
   end if;
  end loop;
 end if;
 if tg_op='DELETE' then return old;end if;
 return new;
end $$;
create trigger listing_checkout_photo_fence before insert or update or delete on app.listing_photos
 for each row execute function app.guard_checkout_photo_edit();
create trigger work_checkout_photo_fence before insert or update or delete on app.work_publication_photos
 for each row execute function app.guard_checkout_photo_edit();
revoke all on function app.guard_checkout_photo_edit() from public;
commit;
