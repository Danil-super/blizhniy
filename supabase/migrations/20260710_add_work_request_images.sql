create table if not exists public.work_request_images (
  id uuid primary key default gen_random_uuid(),
  work_request_id uuid not null references public.work_requests(id) on delete cascade,
  storage_path text not null,
  sort_order integer not null default 0
);

alter table public.work_request_images enable row level security;

create index if not exists work_request_images_work_request_id_idx
  on public.work_request_images (work_request_id);

grant select on public.work_request_images to anon, authenticated;
grant select, insert, update, delete on public.work_request_images to authenticated;

drop policy if exists "Public can read work request images" on public.work_request_images;
drop policy if exists "Owners can insert work request images" on public.work_request_images;
drop policy if exists "Owners can update work request images" on public.work_request_images;
drop policy if exists "Owners can delete work request images" on public.work_request_images;

create policy "Public can read work request images" on public.work_request_images
  for select
  using (
    exists (
      select 1
      from public.work_requests
      where work_requests.id = work_request_images.work_request_id
        and (
          work_requests.status = 'published'
          or work_requests.author_id = (select auth.uid())
          or private.is_admin()
        )
    )
  );

create policy "Owners can insert work request images" on public.work_request_images
  for insert
  with check (
    exists (
      select 1
      from public.work_requests
      where work_requests.id = work_request_images.work_request_id
        and (
          work_requests.author_id = (select auth.uid())
          or private.is_admin()
        )
    )
  );

create policy "Owners can update work request images" on public.work_request_images
  for update
  using (
    exists (
      select 1
      from public.work_requests
      where work_requests.id = work_request_images.work_request_id
        and (
          work_requests.author_id = (select auth.uid())
          or private.is_admin()
        )
    )
  )
  with check (
    exists (
      select 1
      from public.work_requests
      where work_requests.id = work_request_images.work_request_id
        and (
          work_requests.author_id = (select auth.uid())
          or private.is_admin()
        )
    )
  );

create policy "Owners can delete work request images" on public.work_request_images
  for delete
  using (
    exists (
      select 1
      from public.work_requests
      where work_requests.id = work_request_images.work_request_id
        and (
          work_requests.author_id = (select auth.uid())
          or private.is_admin()
        )
    )
  );
