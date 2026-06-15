-- Move SECURITY DEFINER role helpers out of the exposed public schema.
-- Applied to project jzdhpphcelljmjfwrxfi on 2026-06-15.
-- RLS policies use private.is_admin(), while public RPC helpers are removed.

create schema if not exists private;
revoke all on schema private from public;
revoke all on schema private from anon;
revoke all on schema private from authenticated;

create or replace function private.has_role(required_role public.app_role)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.user_roles
    where user_id = (select auth.uid())
      and role = required_role
  );
$$;

create or replace function private.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public, private
as $$
  select private.has_role('admin');
$$;

revoke all on function private.has_role(public.app_role) from public, anon, authenticated;
revoke all on function private.is_admin() from public, anon, authenticated;

alter policy "Users can read own profile" on public.profiles using (id = (select auth.uid()) or private.is_admin());
alter policy "Users can update own profile" on public.profiles using (id = (select auth.uid()) or private.is_admin()) with check (id = (select auth.uid()) or private.is_admin());
alter policy "Admins can insert profiles" on public.profiles with check (private.is_admin());
alter policy "Admins can delete profiles" on public.profiles using (private.is_admin());

alter policy "Users can read own roles" on public.user_roles using (user_id = (select auth.uid()) or private.is_admin());
alter policy "Admins can insert roles" on public.user_roles with check (private.is_admin());
alter policy "Admins can update roles" on public.user_roles using (private.is_admin()) with check (private.is_admin());
alter policy "Admins can delete roles" on public.user_roles using (private.is_admin());

alter policy "Public can read published listings" on public.listings using (status = 'published' or author_id = (select auth.uid()) or private.is_admin());
alter policy "Users can insert own listings" on public.listings with check (author_id = (select auth.uid()) or private.is_admin());
alter policy "Users can update own listings" on public.listings using (author_id = (select auth.uid()) or private.is_admin()) with check (author_id = (select auth.uid()) or private.is_admin());
alter policy "Users can delete own listings" on public.listings using (author_id = (select auth.uid()) or private.is_admin());

alter policy "Public can read listing images" on public.listing_images using (exists (select 1 from public.listings where listings.id = listing_images.listing_id and (listings.status = 'published' or listings.author_id = (select auth.uid()) or private.is_admin())));
alter policy "Owners can insert listing images" on public.listing_images with check (exists (select 1 from public.listings where listings.id = listing_images.listing_id and (listings.author_id = (select auth.uid()) or private.is_admin())));
alter policy "Owners can update listing images" on public.listing_images using (exists (select 1 from public.listings where listings.id = listing_images.listing_id and (listings.author_id = (select auth.uid()) or private.is_admin()))) with check (exists (select 1 from public.listings where listings.id = listing_images.listing_id and (listings.author_id = (select auth.uid()) or private.is_admin())));
alter policy "Owners can delete listing images" on public.listing_images using (exists (select 1 from public.listings where listings.id = listing_images.listing_id and (listings.author_id = (select auth.uid()) or private.is_admin())));

alter policy "Public can read published vacancies" on public.vacancies using (status = 'published' or author_id = (select auth.uid()) or private.is_admin());
alter policy "Users can insert own vacancies" on public.vacancies with check (author_id = (select auth.uid()) or private.is_admin());
alter policy "Users can update own vacancies" on public.vacancies using (author_id = (select auth.uid()) or private.is_admin()) with check (author_id = (select auth.uid()) or private.is_admin());
alter policy "Users can delete own vacancies" on public.vacancies using (author_id = (select auth.uid()) or private.is_admin());

alter policy "Public can read published work requests" on public.work_requests using (status = 'published' or author_id = (select auth.uid()) or private.is_admin());
alter policy "Users can insert own work requests" on public.work_requests with check (author_id = (select auth.uid()) or private.is_admin());
alter policy "Users can update own work requests" on public.work_requests using (author_id = (select auth.uid()) or private.is_admin()) with check (author_id = (select auth.uid()) or private.is_admin());
alter policy "Users can delete own work requests" on public.work_requests using (author_id = (select auth.uid()) or private.is_admin());

alter policy "Public can read published specialists" on public.specialist_profiles using (status = 'published' or user_id = (select auth.uid()) or private.is_admin());
alter policy "Users can insert own specialist profile" on public.specialist_profiles with check (user_id = (select auth.uid()) or private.is_admin());
alter policy "Users can update own specialist profile" on public.specialist_profiles using (user_id = (select auth.uid()) or private.is_admin()) with check (user_id = (select auth.uid()) or private.is_admin());
alter policy "Users can delete own specialist profile" on public.specialist_profiles using (user_id = (select auth.uid()) or private.is_admin());

alter policy "Public can read published organizations" on public.organization_profiles using (status = 'published' or user_id = (select auth.uid()) or private.is_admin());
alter policy "Users can insert own organization profile" on public.organization_profiles with check (user_id = (select auth.uid()) or private.is_admin());
alter policy "Users can update own organization profile" on public.organization_profiles using (user_id = (select auth.uid()) or private.is_admin()) with check (user_id = (select auth.uid()) or private.is_admin());
alter policy "Users can delete own organization profile" on public.organization_profiles using (user_id = (select auth.uid()) or private.is_admin());

alter policy "Users can read own applications" on public.applications using (exists (select 1 from public.specialist_profiles where specialist_profiles.id = applications.specialist_profile_id and specialist_profiles.user_id = (select auth.uid())) or exists (select 1 from public.vacancies where vacancies.id = applications.vacancy_id and vacancies.author_id = (select auth.uid())) or private.is_admin());
alter policy "Specialists can create own applications" on public.applications with check (exists (select 1 from public.specialist_profiles where specialist_profiles.id = applications.specialist_profile_id and specialist_profiles.user_id = (select auth.uid())) or private.is_admin());
alter policy "Admins can update applications" on public.applications using (private.is_admin()) with check (private.is_admin());
alter policy "Admins can delete applications" on public.applications using (private.is_admin());

alter policy "Users can read own payments" on public.payments using (user_id = (select auth.uid()) or private.is_admin());
alter policy "Users can create own payments" on public.payments with check (user_id = (select auth.uid()) or private.is_admin());
alter policy "Admins can update payments" on public.payments using (private.is_admin()) with check (private.is_admin());
alter policy "Admins can delete payments" on public.payments using (private.is_admin());

alter policy "Users can read own notifications" on public.notifications using (user_id = (select auth.uid()) or private.is_admin());
alter policy "Admins can insert notifications" on public.notifications with check (private.is_admin());
alter policy "Admins can update notifications" on public.notifications using (private.is_admin()) with check (private.is_admin());
alter policy "Admins can delete notifications" on public.notifications using (private.is_admin());

alter policy "Public can read published fair applications" on public.fair_applications using (status = 'published' or user_id = (select auth.uid()) or private.is_admin());
alter policy "Users can insert own fair applications" on public.fair_applications with check (user_id = (select auth.uid()) or private.is_admin());
alter policy "Users can update own fair applications" on public.fair_applications using (user_id = (select auth.uid()) or private.is_admin()) with check (user_id = (select auth.uid()) or private.is_admin());
alter policy "Users can delete own fair applications" on public.fair_applications using (user_id = (select auth.uid()) or private.is_admin());

alter policy "Public can read fair application images" on public.fair_application_images using (exists (select 1 from public.fair_applications where fair_applications.id = fair_application_images.fair_application_id and (fair_applications.status = 'published' or fair_applications.user_id = (select auth.uid()) or private.is_admin())));
alter policy "Owners can insert fair application images" on public.fair_application_images with check (exists (select 1 from public.fair_applications where fair_applications.id = fair_application_images.fair_application_id and (fair_applications.user_id = (select auth.uid()) or private.is_admin())));
alter policy "Owners can update fair application images" on public.fair_application_images using (exists (select 1 from public.fair_applications where fair_applications.id = fair_application_images.fair_application_id and (fair_applications.user_id = (select auth.uid()) or private.is_admin()))) with check (exists (select 1 from public.fair_applications where fair_applications.id = fair_application_images.fair_application_id and (fair_applications.user_id = (select auth.uid()) or private.is_admin())));
alter policy "Owners can delete fair application images" on public.fair_application_images using (exists (select 1 from public.fair_applications where fair_applications.id = fair_application_images.fair_application_id and (fair_applications.user_id = (select auth.uid()) or private.is_admin())));

drop function if exists public.is_admin();
drop function if exists public.has_role(public.app_role);
