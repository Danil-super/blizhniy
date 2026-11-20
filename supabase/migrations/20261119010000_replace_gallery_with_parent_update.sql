begin;

-- Write-only input for the same filtered PostgREST PATCH that edits the parent.
alter table public.listings add column replacement_image_paths text[] check (replacement_image_paths is null);
alter table public.vacancies add column replacement_image_paths text[] check (replacement_image_paths is null);
alter table public.work_requests add column replacement_image_paths text[] check (replacement_image_paths is null);

create function private.replace_publication_gallery() returns trigger
language plpgsql security invoker set search_path = '' as $$
declare
  paths text[] := new.replacement_image_paths;
  folder text := tg_argv[0];
begin
  if current_user <> 'service_role' or new.author_id <> old.author_id or new.id <> old.id then
    raise exception 'Gallery update is not permitted' using errcode = '42501';
  end if;
  if cardinality(paths) > tg_argv[1]::integer
     or array_ndims(paths) > 1 or array_lower(paths, 1) <> 1
     or exists (select from unnest(paths) p where p is null or length(p) > 500
       or not starts_with(p, folder || '/' || old.author_id::text || '/')
       or p !~* '^[a-z0-9/_-]+[.](jpe?g|png|webp|gif)$') then
    raise exception 'Invalid gallery paths' using errcode = '22023';
  end if;

  case tg_table_name
    when 'listings' then
      delete from public.listing_images where listing_id = old.id;
      insert into public.listing_images (listing_id, storage_path, sort_order)
        select old.id, path, ord - 1 from unnest(paths) with ordinality as img(path, ord);
    when 'vacancies' then
      new.logo_path := paths[1];
      delete from public.vacancy_images where vacancy_id = old.id;
      insert into public.vacancy_images (vacancy_id, storage_path, sort_order)
        select old.id, path, ord - 1 from unnest(paths) with ordinality as img(path, ord);
    when 'work_requests' then
      new.photo_path := paths[1];
      delete from public.work_request_images where work_request_id = old.id;
      insert into public.work_request_images (work_request_id, storage_path, sort_order)
        select old.id, path, ord - 1 from unnest(paths) with ordinality as img(path, ord);
  end case;
  new.replacement_image_paths := null;
  return new;
end;
$$;
revoke all on function private.replace_publication_gallery() from public, anon, authenticated;

create trigger replace_gallery before update of replacement_image_paths on public.listings
  for each row when (new.replacement_image_paths is not null)
  execute function private.replace_publication_gallery('listings', '20');
create trigger replace_gallery before update of replacement_image_paths on public.vacancies
  for each row when (new.replacement_image_paths is not null)
  execute function private.replace_publication_gallery('vacancies', '20');
create trigger replace_gallery before update of replacement_image_paths on public.work_requests
  for each row when (new.replacement_image_paths is not null)
  execute function private.replace_publication_gallery('work-requests', '6');

notify pgrst, 'reload schema';
commit;
