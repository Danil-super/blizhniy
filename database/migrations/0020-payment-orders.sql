-- Atomic session/target checkout claims. No grants or automatic payment dispatch.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '10s';
alter table app.payment_checkout_intents add constraint payment_intent_order_binding
 unique(id,owner_id,target_type,target_id,target_revision);
create table app.payment_orders (
 id uuid primary key,
 owner_id uuid not null,
 creation_key uuid not null,
 target_type text not null check(target_type in ('listing','vacancy','workRequest','specialist','application','fair_application','ad_marquee')),
 target_id uuid not null,
 target_revision bigint not null check(target_revision>=1),
 status text not null default 'created' check(status in ('created','pending','succeeded','failed','refunded')),
 created_at timestamptz not null default clock_timestamp() check(isfinite(created_at)),
 unique(owner_id,creation_key),
 foreign key(id,owner_id,target_type,target_id,target_revision)
  references app.payment_checkout_intents(id,owner_id,target_type,target_id,target_revision)
  deferrable initially deferred
);
-- UNKNOWN stays active even when the target revision changes. Never release it by age.
create unique index payment_order_active_target_idx on app.payment_orders(owner_id,target_type,target_id)
 where status in ('created','pending','succeeded');
create index payment_order_owner_idx on app.payment_orders(owner_id,created_at desc,id desc);
create function app.guard_payment_order() returns trigger
 language plpgsql set search_path='' as $$ begin
 if tg_op='DELETE' then raise exception using errcode='23514',message='Payment order history is immutable';end if;
 if tg_op='INSERT' then
  if new.status<>'created' then raise exception using errcode='23514',message='Payment order must start unconfirmed';end if;
  return new;
 end if;
 if row(new.id,new.owner_id,new.creation_key,new.target_type,new.target_id,new.target_revision,new.created_at)
  is distinct from row(old.id,old.owner_id,old.creation_key,old.target_type,old.target_id,old.target_revision,old.created_at) then
  raise exception using errcode='23514',message='Payment order binding is immutable';
 end if;
 if new.status<>old.status and not (
  (old.status='created' and new.status in ('pending','succeeded','failed')) or
  (old.status='pending' and new.status in ('succeeded','failed')) or
  (old.status='succeeded' and new.status='refunded')) then
  raise exception using errcode='23514',message='Payment order transition refused';
 end if;
 return new;
end $$;
create trigger payment_order_guard before insert or update or delete on app.payment_orders
 for each row execute function app.guard_payment_order();
revoke all on app.payment_orders from public;
revoke all on function app.guard_payment_order() from public;
commit;
