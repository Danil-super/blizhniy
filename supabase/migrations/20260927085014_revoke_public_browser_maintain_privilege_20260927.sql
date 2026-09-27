-- Postgres 17 MAINTAIN allows maintenance operations such as VACUUM and ANALYZE.
-- Browser API roles never need it, including on tables guarded by RLS.
revoke maintain on all tables in schema public from anon, authenticated;

-- Existing Supabase postgres defaults grant MAINTAIN to both browser roles.
-- Supabase-managed supabase_admin defaults require platform ownership to alter.
alter default privileges for role postgres in schema public
  revoke maintain on tables from anon, authenticated;
