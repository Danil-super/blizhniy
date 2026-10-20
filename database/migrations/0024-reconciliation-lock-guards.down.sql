-- Never leave the lock-only UPDATE grants usable without their mutation guards.
begin;
set local lock_timeout='3s';
set local statement_timeout='10s';
do $$ begin
 if exists(select 1 from pg_roles where rolname='blizhniy_payment_reconciler') then
  if exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
   where n.nspname='app' and c.relname in ('users','payment_checkout_intents','categories','cities','media_objects','listing_moderation')
    and has_any_column_privilege('blizhniy_payment_reconciler',c.oid,'UPDATE')) then
   raise exception 'Revoke reconciliation lock grants before removing guards';
  end if;
 end if;
end $$;
drop trigger reconciliation_lock_only on app.users;
drop trigger reconciliation_lock_only on app.payment_checkout_intents;
drop trigger reconciliation_lock_only on app.categories;
drop trigger reconciliation_lock_only on app.cities;
drop trigger reconciliation_lock_only on app.media_objects;
drop trigger reconciliation_lock_only on app.listing_moderation;
drop function app.guard_reconciliation_locks();
commit;
