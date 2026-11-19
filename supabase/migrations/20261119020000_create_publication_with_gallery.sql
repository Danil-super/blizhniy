begin;

-- The existing gallery trigger validates every path and sets the cover in this transaction.

create function public.create_listing_with_gallery(p_fields jsonb, p_paths text[])
returns setof public.listings
language plpgsql strict security invoker set search_path = '' as $$
declare
  created_id uuid;
begin
  insert into public.listings (
    address, author_id, category_id, city_id, contact_phone, description, booking, district,
    is_paid, latitude, listing_type, longitude, messenger_url, price, published_at, region_id,
    show_exact_address, status, title
  ) select
    address, author_id, category_id, city_id, contact_phone, description, booking, district,
    is_paid, latitude, listing_type, longitude, messenger_url, price, published_at, region_id,
    show_exact_address, status, title
  from jsonb_populate_record(null::public.listings, p_fields)
  returning id into strict created_id;

  return query update public.listings set replacement_image_paths = p_paths
    where id = created_id returning *;
  if not found then
    raise exception 'Gallery write did not complete';
  end if;
end;
$$;
revoke all on function public.create_listing_with_gallery(jsonb, text[]) from public, anon, authenticated;
grant execute on function public.create_listing_with_gallery(jsonb, text[]) to service_role;

create function public.create_vacancy_with_gallery(p_fields jsonb, p_paths text[])
returns setof public.vacancies
language plpgsql strict security invoker set search_path = '' as $$
declare
  created_id uuid;
begin
  insert into public.vacancies (
    address, author_id, city_id, conditions, contact_phone, description, district, email,
    employer_type, is_paid, inn, latitude, longitude, messenger_url, contact_person, ogrn,
    ogrnip, organization_name, placement_right_confirmed, published_at, region_id,
    requirements, responsibilities, salary, schedule, show_exact_address,
    specialist_category_id, status, title, website, work_format
  ) select
    address, author_id, city_id, conditions, contact_phone, description, district, email,
    employer_type, is_paid, inn, latitude, longitude, messenger_url, contact_person, ogrn,
    ogrnip, organization_name, placement_right_confirmed, published_at, region_id,
    requirements, responsibilities, salary, schedule, show_exact_address,
    specialist_category_id, status, title, website, work_format
  from jsonb_populate_record(null::public.vacancies, p_fields)
  returning id into strict created_id;

  return query update public.vacancies set replacement_image_paths = p_paths
    where id = created_id returning *;
  if not found then
    raise exception 'Gallery write did not complete';
  end if;
end;
$$;
revoke all on function public.create_vacancy_with_gallery(jsonb, text[]) from public, anon, authenticated;
grant execute on function public.create_vacancy_with_gallery(jsonb, text[]) to service_role;

create function public.create_work_request_with_gallery(p_fields jsonb, p_paths text[])
returns setof public.work_requests
language plpgsql strict security invoker set search_path = '' as $$
declare
  created_id uuid;
begin
  insert into public.work_requests (
    address, author_id, budget, city_id, contact_phone, description, district, latitude,
    longitude, messenger_url, published_at, region_id, request_type, show_exact_address,
    specialist_category_id, status, title
  ) select
    address, author_id, budget, city_id, contact_phone, description, district, latitude,
    longitude, messenger_url, published_at, region_id, request_type, show_exact_address,
    specialist_category_id, status, title
  from jsonb_populate_record(null::public.work_requests, p_fields)
  returning id into strict created_id;

  return query update public.work_requests set replacement_image_paths = p_paths
    where id = created_id returning *;
  if not found then
    raise exception 'Gallery write did not complete';
  end if;
end;
$$;
revoke all on function public.create_work_request_with_gallery(jsonb, text[]) from public, anon, authenticated;
grant execute on function public.create_work_request_with_gallery(jsonb, text[]) to service_role;

notify pgrst, 'reload schema';
commit;
