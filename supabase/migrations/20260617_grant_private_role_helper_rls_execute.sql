-- Allow RLS policies to evaluate the private admin helper for anon/authenticated roles.
-- The private schema is not exposed through PostgREST RPC, but policies still need
-- USAGE/EXECUTE privileges when the request role evaluates private.is_admin().

grant usage on schema private to anon, authenticated;
grant execute on function private.is_admin() to anon, authenticated;
