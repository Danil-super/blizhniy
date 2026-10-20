-- Private, monotonic authoritative verification. No web-runtime grants or fulfillment.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '10s';
alter table app.payment_provider_links add constraint payment_provider_verification_binding unique(intent_id,provider_payment_id);
create table app.payment_verifications (
 intent_id uuid primary key references app.payment_orders(id) on delete restrict,
 provider_payment_id uuid not null,
 status text not null check(status in ('pending','waiting_for_capture','succeeded','canceled')),
 captured_at text check(captured_at is null or (status='succeeded' and char_length(captured_at)<=30 and
  captured_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,9})?Z$')),
 verified_at timestamptz not null default clock_timestamp() check(isfinite(verified_at)),
 updated_at timestamptz not null default clock_timestamp() check(isfinite(updated_at)),
 foreign key(intent_id,provider_payment_id) references app.payment_provider_links(intent_id,provider_payment_id) on delete restrict
);
create function app.guard_payment_verification() returns trigger
 language plpgsql set search_path='' as $$ begin
 if tg_op='DELETE' then raise exception using errcode='23514',message='Payment verification history cannot be deleted';end if;
 if new.captured_at is not null and pg_catalog.to_char((pg_catalog.left(new.captured_at,19)||'Z')::timestamptz at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS')<>pg_catalog.left(new.captured_at,19) then
  raise exception using errcode='23514',message='Invalid payment capture date';
 end if;
 if tg_op='INSERT' then
  new.verified_at:=pg_catalog.clock_timestamp();new.updated_at:=new.verified_at;return new;
 end if;
 if row(new.intent_id,new.provider_payment_id,new.verified_at) is distinct from row(old.intent_id,old.provider_payment_id,old.verified_at) or
  (old.captured_at is not null and new.captured_at is distinct from old.captured_at) then
  raise exception using errcode='23514',message='Payment verification binding and captured time are immutable';
 end if;
 if new.status<>old.status and not (
  (old.status='pending' and new.status in ('waiting_for_capture','succeeded','canceled')) or
  (old.status='waiting_for_capture' and new.status in ('succeeded','canceled'))) then
  raise exception using errcode='23514',message='Payment verification transition refused';
 end if;
 new.updated_at:=pg_catalog.clock_timestamp();return new;
end $$;
create trigger payment_verification_guard before insert or update or delete on app.payment_verifications
 for each row execute function app.guard_payment_verification();
revoke all on app.payment_verifications from public;
revoke all on function app.guard_payment_verification() from public;
commit;
