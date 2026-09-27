-- Read-only structural checks for a disposable Supabase-compatible deployment.
-- Run as a role able to inspect pg_catalog. Passing this does not replace
-- authenticated Data API negative tests or a restore/replay rehearsal.
do $smoke$
declare
  table_name text;
  browser_role text;
  relation_oid oid;
  unsafe_columns text;
begin
  foreach table_name in array array[
    'profiles', 'payments', 'specialist_profiles', 'listings',
    'vacancies', 'work_requests', 'fair_applications', 'booking_requests',
    'registration_legal_events', 'account_deletion_requests'
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

  foreach table_name in array array['payments', 'specialist_profiles', 'booking_requests'] loop
    relation_oid := to_regclass(format('public.%I', table_name));
    foreach browser_role in array array['anon', 'authenticated'] loop
      select string_agg(attname, ', ' order by attname) into unsafe_columns
      from pg_attribute
      where attrelid = relation_oid and attnum > 0 and not attisdropped
        and (has_column_privilege(browser_role, relation_oid, attname, 'INSERT')
          or has_column_privilege(browser_role, relation_oid, attname, 'UPDATE'));
      if unsafe_columns is not null then
        raise exception 'Browser role % has direct write privileges on public.%: %',
          browser_role, table_name, unsafe_columns;
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

  if has_function_privilege('anon', 'public.record_listing_view(uuid,text)', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.record_listing_view(uuid,text)', 'EXECUTE')
  then
    raise exception 'Browser can invoke public.record_listing_view';
  end if;

  raise notice 'Structural schema, RLS, grants and specialist guard checks passed';
end
$smoke$;
