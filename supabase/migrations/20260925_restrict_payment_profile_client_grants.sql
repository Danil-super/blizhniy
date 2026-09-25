-- Restrict payment state to the trusted server and prevent users from clearing their own blocks.
-- The app writes payments and admin decisions with SUPABASE_SERVICE_ROLE_KEY.
-- Client users can continue to read their own payments and edit their name/phone.
revoke insert, update, delete, truncate, references, trigger
  on table public.payments from anon, authenticated;

drop policy if exists "Users can create own payments" on public.payments;

revoke update on table public.profiles from anon, authenticated;
grant update (display_name, phone) on table public.profiles to authenticated;

do $assert_privileges$
begin
  if has_table_privilege('authenticated', 'public.payments', 'INSERT')
    or has_table_privilege('authenticated', 'public.payments', 'UPDATE')
    or has_table_privilege('anon', 'public.payments', 'INSERT')
    or has_column_privilege('authenticated', 'public.profiles', 'is_blocked', 'UPDATE')
    or has_column_privilege('authenticated', 'public.profiles', 'email', 'UPDATE')
    or not has_column_privilege('authenticated', 'public.profiles', 'display_name', 'UPDATE')
    or not has_column_privilege('authenticated', 'public.profiles', 'phone', 'UPDATE')
    or not has_table_privilege('service_role', 'public.payments', 'INSERT')
    or not has_column_privilege('service_role', 'public.profiles', 'is_blocked', 'UPDATE')
  then
    raise exception 'P0 payment/profile privilege assertions failed';
  end if;
end
$assert_privileges$;
