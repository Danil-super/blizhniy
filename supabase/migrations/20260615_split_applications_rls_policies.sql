-- Split applications admin FOR ALL policy into action-specific policies.
-- Access rules remain equivalent: specialists can create own applications, vacancy owners/specialists can read relevant applications, and admins can manage all applications.
-- Applied to project jzdhpphcelljmjfwrxfi on 2026-06-15.

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
    or private.is_admin()
  );

drop policy if exists "Admins can manage applications" on public.applications;

create policy "Admins can update applications" on public.applications
  for update
  using (private.is_admin())
  with check (private.is_admin());

create policy "Admins can delete applications" on public.applications
  for delete
  using (private.is_admin());
