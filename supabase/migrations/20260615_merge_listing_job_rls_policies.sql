-- Merge overlapping permissive RLS policies on listings, vacancies, and work_requests.
-- Access rules remain equivalent: public can read published rows, owners can manage own rows, and admins can manage all rows.
-- Applied to project jzdhpphcelljmjfwrxfi on 2026-06-15.

-- listings
alter policy "Public can read published listings" on public.listings
  using (status = 'published' or author_id = (select auth.uid()) or public.is_admin());

alter policy "Users can manage own listings" on public.listings
  using (author_id = (select auth.uid()) or public.is_admin())
  with check (author_id = (select auth.uid()) or public.is_admin());

drop policy if exists "Admins can manage listings" on public.listings;

create policy "Admins can delete listings" on public.listings
  for delete
  using (public.is_admin());

-- vacancies
alter policy "Public can read published vacancies" on public.vacancies
  using (status = 'published' or author_id = (select auth.uid()) or public.is_admin());

alter policy "Users can manage own vacancies" on public.vacancies
  using (author_id = (select auth.uid()) or public.is_admin())
  with check (author_id = (select auth.uid()) or public.is_admin());

drop policy if exists "Admins can manage vacancies" on public.vacancies;

create policy "Admins can delete vacancies" on public.vacancies
  for delete
  using (public.is_admin());

-- work_requests
alter policy "Public can read published work requests" on public.work_requests
  using (status = 'published' or author_id = (select auth.uid()) or public.is_admin());

alter policy "Users can manage own work requests" on public.work_requests
  using (author_id = (select auth.uid()) or public.is_admin())
  with check (author_id = (select auth.uid()) or public.is_admin());

drop policy if exists "Admins can manage work requests" on public.work_requests;

create policy "Admins can delete work requests" on public.work_requests
  for delete
  using (public.is_admin());
