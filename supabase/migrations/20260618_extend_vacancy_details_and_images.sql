-- Store vacancy employer details, structured extra fields, and multiple vacancy images.
-- The migration is idempotent so it can be applied safely to environments that already have some columns.

alter table public.vacancies
  add column if not exists employer_type text not null default 'organization',
  add column if not exists inn text,
  add column if not exists ogrn text,
  add column if not exists ogrnip text,
  add column if not exists contact_person text,
  add column if not exists website text,
  add column if not exists messenger_url text,
  add column if not exists work_format text,
  add column if not exists conditions text,
  add column if not exists placement_right_confirmed boolean not null default false;

do $$
begin
  alter table public.vacancies
    add constraint vacancies_employer_type_check
    check (employer_type in ('organization', 'ip', 'person'));
exception
  when duplicate_object then null;
end $$;

create table if not exists public.vacancy_images (
  id uuid primary key default gen_random_uuid(),
  vacancy_id uuid not null references public.vacancies(id) on delete cascade,
  storage_path text not null,
  sort_order integer not null default 0
);

alter table public.vacancy_images enable row level security;

create index if not exists vacancy_images_vacancy_id_idx on public.vacancy_images (vacancy_id);
create index if not exists vacancies_employer_type_idx on public.vacancies (employer_type);

drop policy if exists "Public can read vacancy images" on public.vacancy_images;
drop policy if exists "Owners can insert vacancy images" on public.vacancy_images;
drop policy if exists "Owners can update vacancy images" on public.vacancy_images;
drop policy if exists "Owners can delete vacancy images" on public.vacancy_images;

create policy "Public can read vacancy images" on public.vacancy_images
  for select
  using (
    exists (
      select 1
      from public.vacancies
      where vacancies.id = vacancy_images.vacancy_id
        and (
          vacancies.status = 'published'
          or vacancies.author_id = (select auth.uid())
          or private.is_admin()
        )
    )
  );

create policy "Owners can insert vacancy images" on public.vacancy_images
  for insert
  with check (
    exists (
      select 1
      from public.vacancies
      where vacancies.id = vacancy_images.vacancy_id
        and (
          vacancies.author_id = (select auth.uid())
          or private.is_admin()
        )
    )
  );

create policy "Owners can update vacancy images" on public.vacancy_images
  for update
  using (
    exists (
      select 1
      from public.vacancies
      where vacancies.id = vacancy_images.vacancy_id
        and (
          vacancies.author_id = (select auth.uid())
          or private.is_admin()
        )
    )
  )
  with check (
    exists (
      select 1
      from public.vacancies
      where vacancies.id = vacancy_images.vacancy_id
        and (
          vacancies.author_id = (select auth.uid())
          or private.is_admin()
        )
    )
  );

create policy "Owners can delete vacancy images" on public.vacancy_images
  for delete
  using (
    exists (
      select 1
      from public.vacancies
      where vacancies.id = vacancy_images.vacancy_id
        and (
          vacancies.author_id = (select auth.uid())
          or private.is_admin()
        )
    )
  );
