-- Local opt-in. The target lock serializes checkout preparation with owner edits.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '10s';
create function app.require_resolved_response_checkout(target uuid) returns void
 language plpgsql volatile security definer set search_path='' as $$
begin
 if pg_catalog.current_setting('transaction_isolation')<>'read committed' then
  raise exception 'Response editing requires read committed' using errcode='PWR02';
 end if;
 -- A captured order is unresolved until the response has actually been delivered.
 if exists(select 1 from app.applications a join app.payment_orders o
  on o.target_type='application' and o.target_id=a.id and o.owner_id=a.applicant_id
  where a.work_publication_id=target and (o.status in ('created','pending') or
   (o.status='succeeded' and (not a.is_paid or a.sent_at is null or a.status not in ('sent','viewed','selected','rejected'))))) then
  raise exception 'Resolve response checkout before changing publication' using errcode='PWR01';
 end if;
end $$;
create function app.guard_response_target_edit() returns trigger
 language plpgsql volatile security definer set search_path='' as $$
declare
 bookkeeping text[]:=array['title','updated_at'];
 financial text[]:=array['title','updated_at','status','is_paid','published_at','expires_at'];
begin
 -- Generated title is derived from form; never exclude that source from comparison.
 if (to_jsonb(new)-bookkeeping) is not distinct from (to_jsonb(old)-bookkeeping) then return new;end if;
 if old.status='draft' and not old.is_paid and new.status='published' and new.is_paid
  and (to_jsonb(new)-financial) is not distinct from (to_jsonb(old)-financial) then return new;end if;
 -- A completed refund must still terminate its exact original placement.
 if old.is_paid and not new.is_paid and new.status=(case when old.status in ('published','paid') then 'archived' else old.status end)
  and (to_jsonb(new)-array['title','updated_at','status','is_paid']) is not distinct from (to_jsonb(old)-array['title','updated_at','status','is_paid'])
  and exists(select 1 from app.payment_checkout_intents i join app.payment_orders o on o.id=i.id
   join app.payment_fulfillments f on f.intent_id=i.id
   where i.owner_id=old.author_id and i.target_type=old.kind and i.target_id=old.id and o.status='refunded'
    and f.published_at=old.published_at and f.expires_at=old.expires_at) then return new;end if;
 perform app.require_resolved_response_checkout(old.id);
 return new;
end $$;
create trigger work_response_edit_fence before update on app.work_publications
 for each row execute function app.guard_response_target_edit();

create function app.guard_response_photo_edit() returns trigger
 language plpgsql volatile security definer set search_path='' as $$
declare affected uuid[];target uuid;
begin
 if tg_op='UPDATE' and new is not distinct from old then return new;end if;
 if pg_catalog.current_setting('transaction_isolation')<>'read committed' then
  raise exception 'Response editing requires read committed' using errcode='PWR02';
 end if;
 affected:=array[(to_jsonb(old)->>'publication_id')::uuid,(to_jsonb(new)->>'publication_id')::uuid];
 -- Run before the older photo trigger; never wait holding a child-row lock.
 for target in select w.id from app.work_publications w where w.id=any(affected) order by w.id for update nowait loop
  perform app.require_resolved_response_checkout(target);
 end loop;
 if tg_op='DELETE' then return old;end if;
 return new;
end $$;
create trigger aa_work_response_photo_fence before insert or update or delete on app.work_publication_photos
 for each row execute function app.guard_response_photo_edit();

create function app.guard_response_selection() returns trigger
 language plpgsql volatile security definer set search_path='' as $$
declare target uuid;
begin
 if new.status='selected' and old.status is distinct from 'selected' then
  select w.id into target from app.work_publications w where w.id=new.work_publication_id and w.kind='workRequest' for update nowait;
  if found then perform app.require_resolved_response_checkout(target);end if;
 end if;
 return new;
end $$;
create trigger application_response_selection_fence before update on app.applications
 for each row execute function app.guard_response_selection();
revoke all on function app.require_resolved_response_checkout(uuid),app.guard_response_target_edit(),app.guard_response_photo_edit(),app.guard_response_selection() from public;
commit;
