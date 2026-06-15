-- Split owner/admin FOR ALL policies on specialist_profiles and organization_profiles into action-specific policies.
-- Access rules remain equivalent: public can read published profiles, owners can manage own profiles, and admins can manage all profiles.
-- Applied to project jzdhpphcelljmjfwrxfi on 2026-06-15.

-- specialist_profiles
alter policy "Public can read published specialists" on public.specialist_profiles
  using (status = 'published' or user_id = (select auth.uid()) or public.is_admin());

drop policy if exists "Users can manage own specialist profile" on public.specialist_profiles;
drop policy if exists "Admins can manage specialist profiles" on public.specialist_profiles;

create policy "Users can insert own specialist profile" on public.specialist_profiles
  for insert
  with check (user_id = (select auth.uid()) or public.is_admin());

create policy "Users can update own specialist profile" on public.specialist_profiles
  for update
  using (user_id = (select auth.uid()) or public.is_admin())
  with check (user_id = (select auth.uid()) or public.is_admin());

create policy "Users can delete own specialist profile" on public.specialist_profiles
  for delete
  using (user_id = (select auth.uid()) or public.is_admin());

-- organization_profiles
alter policy "Public can read published organizations" on public.organization_profiles
  using (status = 'published' or user_id = (select auth.uid()) or public.is_admin());

drop policy if exists "Users can manage own organization profile" on public.organization_profiles;
drop policy if exists "Admins can manage organization profiles" on public.organization_profiles;

create policy "Users can insert own organization profile" on public.organization_profiles
  for insert
  with check (user_id = (select auth.uid()) or public.is_admin());

create policy "Users can update own organization profile" on public.organization_profiles
  for update
  using (user_id = (select auth.uid()) or public.is_admin())
  with check (user_id = (select auth.uid()) or public.is_admin());

create policy "Users can delete own organization profile" on public.organization_profiles
  for delete
  using (user_id = (select auth.uid()) or public.is_admin());
