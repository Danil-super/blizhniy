-- Merge overlapping permissive RLS policies on profiles and user_roles.
-- Access rules remain equivalent: owners can read/update their own rows and admins can manage all rows.
-- Applied to project jzdhpphcelljmjfwrxfi on 2026-06-15.

-- profiles
alter policy "Users can read own profile" on public.profiles
  using (id = (select auth.uid()) or public.is_admin());

alter policy "Users can update own profile" on public.profiles
  using (id = (select auth.uid()) or public.is_admin())
  with check (id = (select auth.uid()) or public.is_admin());

drop policy if exists "Admins can manage profiles" on public.profiles;

create policy "Admins can insert profiles" on public.profiles
  for insert
  with check (public.is_admin());

create policy "Admins can delete profiles" on public.profiles
  for delete
  using (public.is_admin());

-- user_roles
alter policy "Users can read own roles" on public.user_roles
  using (user_id = (select auth.uid()) or public.is_admin());

drop policy if exists "Admins can manage roles" on public.user_roles;

create policy "Admins can insert roles" on public.user_roles
  for insert
  with check (public.is_admin());

create policy "Admins can update roles" on public.user_roles
  for update
  using (public.is_admin())
  with check (public.is_admin());

create policy "Admins can delete roles" on public.user_roles
  for delete
  using (public.is_admin());
