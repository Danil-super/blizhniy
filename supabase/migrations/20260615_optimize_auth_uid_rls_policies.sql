-- Optimize RLS policies by evaluating auth.uid() once per statement via scalar subselects.
-- This keeps the same access rules and only changes the expression form recommended by Supabase advisors.
-- Applied to project jzdhpphcelljmjfwrxfi on 2026-06-15.

alter policy "Users can read own profile" on public.profiles
  using (id = (select auth.uid()) or private.is_admin());

alter policy "Users can update own profile" on public.profiles
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

alter policy "Users can read own roles" on public.user_roles
  using (user_id = (select auth.uid()) or private.is_admin());

alter policy "Users can manage own listings" on public.listings
  using (author_id = (select auth.uid()))
  with check (author_id = (select auth.uid()));

alter policy "Owners can manage listing images" on public.listing_images
  using (
    exists (
      select 1
      from public.listings
      where listings.id = listing_images.listing_id
        and listings.author_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1
      from public.listings
      where listings.id = listing_images.listing_id
        and listings.author_id = (select auth.uid())
    )
  );

alter policy "Users can manage own vacancies" on public.vacancies
  using (author_id = (select auth.uid()))
  with check (author_id = (select auth.uid()));

alter policy "Users can manage own work requests" on public.work_requests
  using (author_id = (select auth.uid()))
  with check (author_id = (select auth.uid()));

alter policy "Users can manage own specialist profile" on public.specialist_profiles
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

alter policy "Users can manage own organization profile" on public.organization_profiles
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

alter policy "Users can read own applications" on public.applications
  using (
    exists (
      select 1
      from public.specialist_profiles
      where specialist_profiles.id = applications.specialist_profile_id
        and specialist_profiles.user_id = (select auth.uid())
    )
    or exists (
      select 1
      from public.vacancies
      where vacancies.id = applications.vacancy_id
        and vacancies.author_id = (select auth.uid())
    )
    or private.is_admin()
  );

alter policy "Specialists can create own applications" on public.applications
  with check (
    exists (
      select 1
      from public.specialist_profiles
      where specialist_profiles.id = applications.specialist_profile_id
        and specialist_profiles.user_id = (select auth.uid())
    )
  );

alter policy "Users can manage own fair applications" on public.fair_applications
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

alter policy "Owners can manage fair application images" on public.fair_application_images
  using (
    exists (
      select 1
      from public.fair_applications
      where fair_applications.id = fair_application_images.fair_application_id
        and fair_applications.user_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1
      from public.fair_applications
      where fair_applications.id = fair_application_images.fair_application_id
        and fair_applications.user_id = (select auth.uid())
    )
  );

alter policy "Users can read own payments" on public.payments
  using (user_id = (select auth.uid()) or private.is_admin());

alter policy "Users can create own payments" on public.payments
  with check (user_id = (select auth.uid()));

alter policy "Users can read own notifications" on public.notifications
  using (user_id = (select auth.uid()) or private.is_admin());
