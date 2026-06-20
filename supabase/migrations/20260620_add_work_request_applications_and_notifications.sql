-- Extend paid responses to customer work requests and add decision statuses.

alter table public.applications
  alter column vacancy_id drop not null,
  add column if not exists work_request_id uuid references public.work_requests(id) on delete cascade;

alter table public.applications
  drop constraint if exists applications_target_check,
  add constraint applications_target_check
  check (
    (vacancy_id is not null and work_request_id is null)
    or (vacancy_id is null and work_request_id is not null)
  );

alter table public.applications
  drop constraint if exists applications_status_check,
  add constraint applications_status_check
  check (status in ('pending_payment', 'paid', 'sent', 'viewed', 'selected', 'rejected'));

create unique index if not exists applications_vacancy_applicant_unique
  on public.applications (vacancy_id, applicant_user_id)
  where vacancy_id is not null and applicant_user_id is not null;

create unique index if not exists applications_work_request_applicant_unique
  on public.applications (work_request_id, applicant_user_id)
  where work_request_id is not null and applicant_user_id is not null;

create index if not exists applications_work_request_id_idx on public.applications (work_request_id);

grant select, insert, update on public.applications to authenticated;
grant select, update on public.notifications to authenticated;

drop policy if exists "Users can read own applications" on public.applications;
drop policy if exists "Specialists can create own applications" on public.applications;
drop policy if exists "Users can update own application drafts" on public.applications;

create policy "Users can read own applications" on public.applications
  for select
  using (
    applicant_user_id = (select auth.uid())
    or exists (
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
    or exists (
      select 1
      from public.work_requests
      where work_requests.id = applications.work_request_id
        and work_requests.author_id = (select auth.uid())
    )
    or private.is_admin()
  );

create policy "Specialists can create own applications" on public.applications
  for insert
  with check (
    applicant_user_id = (select auth.uid())
    or exists (
      select 1
      from public.specialist_profiles
      where specialist_profiles.id = applications.specialist_profile_id
        and specialist_profiles.user_id = (select auth.uid())
    )
    or private.is_admin()
  );

create policy "Users can update own application drafts" on public.applications
  for update
  using (
    applicant_user_id = (select auth.uid())
    or exists (
      select 1
      from public.vacancies
      where vacancies.id = applications.vacancy_id
        and vacancies.author_id = (select auth.uid())
    )
    or exists (
      select 1
      from public.work_requests
      where work_requests.id = applications.work_request_id
        and work_requests.author_id = (select auth.uid())
    )
    or private.is_admin()
  )
  with check (
    applicant_user_id = (select auth.uid())
    or exists (
      select 1
      from public.vacancies
      where vacancies.id = applications.vacancy_id
        and vacancies.author_id = (select auth.uid())
    )
    or exists (
      select 1
      from public.work_requests
      where work_requests.id = applications.work_request_id
        and work_requests.author_id = (select auth.uid())
    )
    or private.is_admin()
  );
