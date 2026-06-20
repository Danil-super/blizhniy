-- Harden paid application responses.
-- Clients must use Next.js API routes; direct Supabase REST access is read-only and only for owned/delivered rows.

update public.applications
set specialist_profile_id = specialist_profiles.id
from public.specialist_profiles
where public.applications.specialist_profile_id is null
  and public.applications.applicant_user_id = specialist_profiles.user_id;

revoke insert, update, delete on public.applications from authenticated;
grant select on public.applications to authenticated;

drop policy if exists "Users can read own applications" on public.applications;
drop policy if exists "Specialists can create own applications" on public.applications;
drop policy if exists "Users can update own application drafts" on public.applications;

create policy "Users can read own applications" on public.applications
  for select
  using (
    applicant_user_id = (select auth.uid())
    or (
      is_paid = true
      and status in ('sent', 'viewed', 'selected', 'rejected')
      and exists (
        select 1
        from public.vacancies
        where vacancies.id = applications.vacancy_id
          and vacancies.author_id = (select auth.uid())
      )
    )
    or (
      is_paid = true
      and status in ('sent', 'viewed', 'selected', 'rejected')
      and exists (
        select 1
        from public.work_requests
        where work_requests.id = applications.work_request_id
          and work_requests.author_id = (select auth.uid())
      )
    )
    or private.is_admin()
  );
