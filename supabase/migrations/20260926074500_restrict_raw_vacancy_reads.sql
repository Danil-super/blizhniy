-- Published vacancies may store a private street address and exact coordinates.
-- All vacancy reads/writes in the Next.js app use the server's service role;
-- browser roles must not receive an unredacted row through the Data API.
revoke select on table public.vacancies from anon, authenticated;

do $assert_private_vacancy_location$
begin
  if has_table_privilege('anon', 'public.vacancies', 'SELECT')
    or has_table_privilege('authenticated', 'public.vacancies', 'SELECT')
    or not has_table_privilege('service_role', 'public.vacancies', 'SELECT')
    or not has_table_privilege('service_role', 'public.vacancies', 'INSERT')
    or not has_table_privilege('service_role', 'public.vacancies', 'UPDATE')
  then
    raise exception 'Unsafe vacancy Data API grants';
  end if;
end
$assert_private_vacancy_location$;
