-- Split fair_applications owner/admin FOR ALL policies into action-specific policies.
-- Access rules remain equivalent: public can read published fair applications, owners can manage own fair applications, and admins can manage all fair applications.
-- Applied to project jzdhpphcelljmjfwrxfi on 2026-06-15.

alter policy "Public can read published fair applications" on public.fair_applications
  using (status = 'published' or user_id = (select auth.uid()) or private.is_admin());

drop policy if exists "Users can manage own fair applications" on public.fair_applications;
drop policy if exists "Admins can manage fair applications" on public.fair_applications;

create policy "Users can insert own fair applications" on public.fair_applications
  for insert
  with check (user_id = (select auth.uid()) or private.is_admin());

create policy "Users can update own fair applications" on public.fair_applications
  for update
  using (user_id = (select auth.uid()) or private.is_admin())
  with check (user_id = (select auth.uid()) or private.is_admin());

create policy "Users can delete own fair applications" on public.fair_applications
  for delete
  using (user_id = (select auth.uid()) or private.is_admin());
