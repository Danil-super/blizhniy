-- Owner-only cabinet settings and unpublished organization details.
-- The service-role API checks the authenticated user before every access.
create table if not exists public.cabinet_private_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  profile jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  constraint cabinet_private_profiles_size check (octet_length(profile::text) <= 500000)
);

alter table public.cabinet_private_profiles enable row level security;
revoke all on table public.cabinet_private_profiles from public, anon, authenticated;
grant select, insert, update, delete on table public.cabinet_private_profiles to service_role;

do $assert_private_profile$
begin
  if has_table_privilege('anon', 'public.cabinet_private_profiles', 'SELECT')
    or has_table_privilege('authenticated', 'public.cabinet_private_profiles', 'SELECT')
    or has_table_privilege('authenticated', 'public.cabinet_private_profiles', 'INSERT')
    or has_table_privilege('authenticated', 'public.cabinet_private_profiles', 'UPDATE')
    or not has_table_privilege('service_role', 'public.cabinet_private_profiles', 'SELECT')
    or not has_table_privilege('service_role', 'public.cabinet_private_profiles', 'INSERT')
    or not has_table_privilege('service_role', 'public.cabinet_private_profiles', 'UPDATE')
  then
    raise exception 'Cabinet profile grant assertions failed';
  end if;
end
$assert_private_profile$;
