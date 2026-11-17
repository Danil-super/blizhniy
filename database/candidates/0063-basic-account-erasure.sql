-- Candidate only: basic-account primary erasure receipts and late-writer fences.
-- No installed role, grants, automatic startup or production activation.
begin;
set local lock_timeout='3s';
set local statement_timeout='10s';
alter table app_admin.migrations drop constraint migrations_name_check;
alter table app_admin.migrations add constraint migrations_name_check
 check(name in ('0061-admin-user-access.sql','0062-admin-tariffs.sql','0063-basic-account-erasure.sql'));
create table app_admin.basic_account_erasures (
 operation_id uuid primary key,
 request_id uuid not null unique references app.account_deletion_requests(id),
 subject_id uuid not null unique,
 actor_id uuid not null,
 expected_auth_version bigint not null check(expected_auth_version>=0),
 expected_request_revision bigint not null check(expected_request_revision>=1),
 completed_at timestamptz not null default clock_timestamp() check(isfinite(completed_at))
);
revoke all on app_admin.basic_account_erasures from public;
create function app_admin.guard_basic_account_erasure() returns trigger language plpgsql
set search_path='' as $$
begin
 raise exception 'Erasure receipt is append-only' using errcode='42501';
end;
$$;
revoke all on function app_admin.guard_basic_account_erasure() from public;
create trigger basic_account_erasure_immutable before update or delete on app_admin.basic_account_erasures
 for each row execute function app_admin.guard_basic_account_erasure();
alter table app_admin.basic_account_erasures enable always trigger basic_account_erasure_immutable;
create function app_admin.fence_erased_identity() returns trigger language plpgsql security definer
set search_path='' as $$
declare subject uuid;
begin
 if pg_catalog.current_setting('transaction_isolation')<>'read committed' then
  raise exception 'Erasure-fenced writes require read committed' using errcode='23514';end if;
 if tg_table_schema='app' and tg_table_name='users' then subject:=new.id;
 elsif tg_table_schema='app' and tg_table_name in ('payment_checkout_intents','payment_orders') then subject:=new.owner_id;
 else raise exception 'Unsupported erasure fence target' using errcode='42501';end if;
 if exists(select 1 from app_admin.basic_account_erasures where subject_id=subject) then
  raise exception 'Erased identity cannot receive new operations' using errcode='23514';end if;
 return new;
end;
$$;
revoke all on function app_admin.fence_erased_identity() from public;
create trigger users_erasure_fence before insert or update of id on app.users
 for each row execute function app_admin.fence_erased_identity();
create trigger checkout_intents_erasure_fence before insert or update of owner_id on app.payment_checkout_intents
 for each row execute function app_admin.fence_erased_identity();
create trigger payment_orders_erasure_fence before insert or update of owner_id on app.payment_orders
 for each row execute function app_admin.fence_erased_identity();
alter table app.users enable always trigger users_erasure_fence;
alter table app.payment_checkout_intents enable always trigger checkout_intents_erasure_fence;
alter table app.payment_orders enable always trigger payment_orders_erasure_fence;
commit;
