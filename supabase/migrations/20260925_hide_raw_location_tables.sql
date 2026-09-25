-- Public listings and profiles are rendered by authenticated server routes using the service role.
-- Raw Data API rows contain private address and coordinates even when show_exact_address=false.
-- Browser clients do not query these four tables directly; no raw row may be exposed via anon/authenticated.
revoke select on table public.listings, public.work_requests, public.specialist_profiles, public.fair_applications
  from anon, authenticated;

do $assert_private_locations$
declare
  exposed_table text;
begin
  foreach exposed_table in array array['listings', 'work_requests', 'specialist_profiles', 'fair_applications'] loop
    if has_table_privilege('anon', format('public.%I', exposed_table), 'SELECT')
      or has_table_privilege('authenticated', format('public.%I', exposed_table), 'SELECT')
      or not has_table_privilege('service_role', format('public.%I', exposed_table), 'SELECT')
    then
      raise exception 'Private location table % has unsafe SELECT grants', exposed_table;
    end if;
  end loop;
end
$assert_private_locations$;
