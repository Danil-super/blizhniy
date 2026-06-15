-- Split owner FOR ALL policies on listings, vacancies, and work_requests into action-specific policies.
-- This removes remaining multiple permissive SELECT/DELETE overlap while preserving equivalent access rules.
-- Applied to project jzdhpphcelljmjfwrxfi on 2026-06-15.

-- listings
alter policy "Public can read published listings" on public.listings
  using (status = 'published' or author_id = (select auth.uid()) or public.is_admin());

drop policy if exists "Users can manage own listings" on public.listings;
drop policy if exists "Admins can delete listings" on public.listings;

create policy "Users can insert own listings" on public.listings
  for insert
  with check (author_id = (select auth.uid()) or public.is_admin());

create policy "Users can update own listings" on public.listings
  for update
  using (author_id = (select auth.uid()) or public.is_admin())
  with check (author_id = (select auth.uid()) or public.is_admin());

create policy "Users can delete own listings" on public.listings
  for delete
  using (author_id = (select auth.uid()) or public.is_admin());

-- vacancies
alter policy "Public can read published vacancies" on public.vacancies
  using (status = 'published' or author_id = (select auth.uid()) or public.is_admin());

drop policy if exists "Users can manage own vacancies" on public.vacancies;
drop policy if exists "Admins can delete vacancies" on public.vacancies;

create policy "Users can insert own vacancies" on public.vacancies
  for insert
  with check (author_id = (select auth.uid()) or public.is_admin());

create policy "Users can update own vacancies" on public.vacancies
  for update
  using (author_id = (select auth.uid()) or public.is_admin())
  with check (author_id = (select auth.uid()) or public.is_admin());

create policy "Users can delete own vacancies" on public.vacancies
  for delete
  using (author_id = (select auth.uid()) or public.is_admin());

-- work_requests
alter policy "Public can read published work requests" on public.work_requests
  using (status = 'published' or author_id = (select auth.uid()) or public.is_admin());

drop policy if exists "Users can manage own work requests" on public.work_requests;
drop policy if exists "Admins can delete work requests" on public.work_requests;

create policy "Users can insert own work requests" on public.work_requests
  for insert
  with check (author_id = (select auth.uid()) or public.is_admin());

create policy "Users can update own work requests" on public.work_requests
  for update
  using (author_id = (select auth.uid()) or public.is_admin())
  with check (author_id = (select auth.uid()) or public.is_admin());

create policy "Users can delete own work requests" on public.work_requests
  for delete
  using (author_id = (select auth.uid()) or public.is_admin());
