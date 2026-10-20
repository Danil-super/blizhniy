-- Opt-in only. UPDATE(id) is needed for row locks, not permission to mutate identity/reference keys.
-- No roles/grants or financial mode changes. This pinned worker role is not installed here.
begin;
set local lock_timeout='3s';
set local statement_timeout='10s';
create function app.guard_reconciliation_locks() returns trigger
 language plpgsql security invoker set search_path='' as $$ begin
 if current_user='blizhniy_payment_reconciler' or session_user='blizhniy_payment_reconciler' then
  raise exception using errcode='23514',message='Reconciliation lock-only relation';
 end if;
 return new;
end $$;
create trigger reconciliation_lock_only before update on app.users
 for each row execute function app.guard_reconciliation_locks();
create trigger reconciliation_lock_only before update on app.payment_checkout_intents
 for each row execute function app.guard_reconciliation_locks();
create trigger reconciliation_lock_only before update on app.categories
 for each row execute function app.guard_reconciliation_locks();
create trigger reconciliation_lock_only before update on app.cities
 for each row execute function app.guard_reconciliation_locks();
create trigger reconciliation_lock_only before update on app.media_objects
 for each row execute function app.guard_reconciliation_locks();
create trigger reconciliation_lock_only before update on app.listing_moderation
 for each row execute function app.guard_reconciliation_locks();
alter table app.users enable always trigger reconciliation_lock_only;
alter table app.payment_checkout_intents enable always trigger reconciliation_lock_only;
alter table app.categories enable always trigger reconciliation_lock_only;
alter table app.cities enable always trigger reconciliation_lock_only;
alter table app.media_objects enable always trigger reconciliation_lock_only;
alter table app.listing_moderation enable always trigger reconciliation_lock_only;
revoke all on function app.guard_reconciliation_locks() from public;
commit;
