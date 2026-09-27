-- Read-only structural checks for a disposable Supabase-compatible deployment.
-- Run as a role able to inspect pg_catalog. Passing this does not replace
-- authenticated Data API negative tests or a restore/replay rehearsal.
do $smoke$
declare
  table_name text;
  browser_role text;
  relation_oid oid;
  unsafe_columns text;
  raw_column text;
begin
  foreach table_name in array array[
    'profiles', 'payments', 'specialist_profiles', 'listings',
    'vacancies', 'work_requests', 'fair_applications', 'booking_requests',
    'registration_legal_events', 'account_deletion_requests',
    'organization_profiles'
  ] loop
    relation_oid := to_regclass(format('public.%I', table_name));
    if relation_oid is null or not exists (
      select 1 from pg_class where oid = relation_oid and relrowsecurity
    ) then
      raise exception 'Missing table or RLS disabled: public.%', table_name;
    end if;
  end loop;

  if not exists (select 1 from pg_class where oid = 'storage.objects'::regclass and relrowsecurity) then
    raise exception 'RLS disabled on storage.objects';
  end if;

  foreach table_name in array array[
    'payments', 'specialist_profiles', 'booking_requests',
    'listings', 'listing_images', 'vacancies', 'vacancy_images',
    'work_requests', 'work_request_images', 'fair_applications',
    'fair_application_images', 'ad_marquee_placements', 'organization_profiles'
  ] loop
    relation_oid := to_regclass(format('public.%I', table_name));
    foreach browser_role in array array['anon', 'authenticated'] loop
      select string_agg(attname, ', ' order by attname) into unsafe_columns
      from pg_attribute
      where attrelid = relation_oid and attnum > 0 and not attisdropped
        and (has_column_privilege(browser_role, relation_oid, attname, 'INSERT')
          or has_column_privilege(browser_role, relation_oid, attname, 'UPDATE'));
      if unsafe_columns is not null
        or has_table_privilege(browser_role, relation_oid, 'DELETE')
        or (table_name not in ('payments', 'booking_requests')
          and has_table_privilege(browser_role, relation_oid, 'MAINTAIN'))
      then
        raise exception 'Browser role % has direct write privileges on public.%: %',
          browser_role, table_name, coalesce(unsafe_columns, 'DELETE/MAINTAIN');
      end if;
    end loop;
  end loop;

  if not exists (
    select 1 from pg_trigger
    where tgrelid = 'public.specialist_profiles'::regclass
      and tgname = 'reject_unpaid_specialist_activation'
      and tgenabled in ('O', 'A')
  ) then
    raise exception 'Specialist publication guard missing or disabled';
  end if;

  if not has_function_privilege('service_role', 'public.record_listing_view(uuid,text)', 'EXECUTE') then
    raise exception 'Server cannot invoke public.record_listing_view';
  end if;

  if has_function_privilege('anon', 'public.record_listing_view(uuid,text)', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.record_listing_view(uuid,text)', 'EXECUTE')
  then
    raise exception 'Browser can invoke public.record_listing_view';
  end if;

  -- TRUNCATE bypasses row-level security. Browser roles must also never
  -- create triggers or reference other tables as a schema privilege.
  for relation_oid in
    select c.oid from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p')
  loop
    foreach browser_role in array array['anon', 'authenticated'] loop
      if has_table_privilege(browser_role, relation_oid, 'TRUNCATE')
        or has_table_privilege(browser_role, relation_oid, 'TRIGGER')
        or has_table_privilege(browser_role, relation_oid, 'REFERENCES')
        or has_table_privilege(browser_role, relation_oid, 'MAINTAIN') then
        raise exception 'Browser role % has unsafe table privileges on %',
          browser_role, relation_oid::regclass;
      end if;
    end loop;
  end loop;

  if exists (
    select 1
    from pg_default_acl d
    join pg_namespace n on n.oid = d.defaclnamespace
    cross join lateral aclexplode(d.defaclacl) acl
    join pg_roles r on r.oid = acl.grantee
    where n.nspname = 'public'
      and d.defaclrole = 'postgres'::regrole
      and d.defaclobjtype = 'r'
      and r.rolname in ('anon', 'authenticated')
      and acl.privilege_type = 'MAINTAIN'
  ) then
    raise exception 'postgres defaults grant browser MAINTAIN on future public tables';
  end if;

  foreach table_name in array array[
    'listings', 'vacancies', 'work_requests',
    'specialist_profiles', 'fair_applications'
  ] loop
    relation_oid := to_regclass(format('public.%I', table_name));
    foreach browser_role in array array['anon', 'authenticated'] loop
      foreach raw_column in array array['address', 'latitude', 'longitude'] loop
        if has_column_privilege(browser_role, relation_oid, raw_column, 'SELECT') then
          raise exception 'Browser role % can read private %.%',
            browser_role, relation_oid::regclass, raw_column;
        end if;
      end loop;
    end loop;
  end loop;

  foreach browser_role in array array['anon', 'authenticated'] loop
    if has_column_privilege(browser_role, 'public.profiles'::regclass, 'is_blocked', 'UPDATE') then
      raise exception 'Browser role % can update profiles.is_blocked', browser_role;
    end if;
  end loop;

  raise notice 'Structural schema, RLS, grants and specialist guard checks passed';
end
$smoke$;
