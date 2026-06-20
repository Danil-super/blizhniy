-- Make job applications usable as paid production responses.
-- Existing columns remain for compatibility with earlier demo/RLS policies.

alter table public.applications
  alter column specialist_profile_id drop not null,
  add column if not exists applicant_user_id uuid references public.profiles(id) on delete cascade,
  add column if not exists specialist_name text,
  add column if not exists specialist_profession text,
  add column if not exists specialist_price text,
  add column if not exists specialist_skills text,
  add column if not exists specialist_phone text,
  add column if not exists specialist_email text,
  add column if not exists specialist_messenger_url text,
  add column if not exists updated_at timestamptz not null default now();

update public.applications
set applicant_user_id = specialist_profiles.user_id
from public.specialist_profiles
where public.applications.specialist_profile_id = specialist_profiles.id
  and public.applications.applicant_user_id is null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'applications_status_check'
      and conrelid = 'public.applications'::regclass
  ) then
    alter table public.applications
      add constraint applications_status_check
      check (status in ('pending_payment', 'paid', 'sent', 'viewed', 'rejected'));
  end if;
end $$;

create unique index if not exists applications_vacancy_applicant_unique
  on public.applications (vacancy_id, applicant_user_id)
  where applicant_user_id is not null;

create index if not exists applications_applicant_user_id_idx on public.applications (applicant_user_id);
create index if not exists applications_status_created_at_idx on public.applications (status, created_at desc);
create index if not exists applications_sent_at_idx on public.applications (sent_at desc);

grant select, insert, update on public.applications to authenticated;

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
    or private.is_admin()
  );
