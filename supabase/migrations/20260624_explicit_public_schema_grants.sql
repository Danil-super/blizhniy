-- Supabase Data API access now depends on explicit privileges for exposed schemas.
-- RLS policies still define row-level access; these grants only make intended tables
-- reachable to anon/authenticated roles. Missing optional tables are skipped.

grant usage on schema public to anon, authenticated;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'regions',
    'cities',
    'categories',
    'specialist_categories',
    'tariffs',
    'listings',
    'listing_images',
    'vacancies',
    'vacancy_images',
    'work_requests',
    'specialist_profiles',
    'organization_profiles',
    'fair_applications',
    'fair_application_images'
  ]
  loop
    if to_regclass(format('public.%I', table_name)) is not null then
      execute format('grant select on public.%I to anon, authenticated', table_name);
    end if;
  end loop;

  foreach table_name in array array[
    'profiles',
    'organization_profiles',
    'listings',
    'listing_images',
    'vacancies',
    'vacancy_images',
    'work_requests',
    'specialist_profiles',
    'fair_applications',
    'fair_application_images',
    'notifications'
  ]
  loop
    if to_regclass(format('public.%I', table_name)) is not null then
      execute format('grant select, insert, update, delete on public.%I to authenticated', table_name);
    end if;
  end loop;

  foreach table_name in array array[
    'user_roles',
    'payments'
  ]
  loop
    if to_regclass(format('public.%I', table_name)) is not null then
      execute format('grant select on public.%I to authenticated', table_name);
    end if;
  end loop;

  foreach table_name in array array[
    'applications',
    'booking_requests'
  ]
  loop
    if to_regclass(format('public.%I', table_name)) is not null then
      execute format('grant select, insert, update on public.%I to authenticated', table_name);
    end if;
  end loop;
end $$;
