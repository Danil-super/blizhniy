-- Keep the nonpersonal case record after erasure without blocking deletion
-- of auth.users. A detached case has no user ID or email in this table.
alter table public.account_deletion_requests
  alter column user_id drop not null;

alter table public.account_deletion_requests
  drop constraint account_deletion_requests_user_id_fkey;

alter table public.account_deletion_requests
  add constraint account_deletion_requests_user_id_fkey
  foreign key (user_id) references auth.users (id) on delete set null;

do $verify_detached_case$
begin
  if (select attnotnull from pg_attribute
      where attrelid = 'public.account_deletion_requests'::regclass and attname = 'user_id')
    or not exists (
      select 1 from pg_constraint
      where conrelid = 'public.account_deletion_requests'::regclass
        and conname = 'account_deletion_requests_user_id_fkey'
        and confdeltype = 'n'
    )
    or not (select relrowsecurity from pg_class where oid = 'public.account_deletion_requests'::regclass)
    or has_table_privilege('anon', 'public.account_deletion_requests', 'SELECT')
    or has_table_privilege('authenticated', 'public.account_deletion_requests', 'SELECT')
    or not has_table_privilege('service_role', 'public.account_deletion_requests', 'SELECT')
  then
    raise exception 'account deletion case detachment safety assertions failed';
  end if;
end
$verify_detached_case$;
