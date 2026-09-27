-- Browser roles must not be able to bypass RLS with TRUNCATE or define triggers/foreign keys.
revoke truncate, trigger, references on all tables in schema public from anon, authenticated;
alter default privileges in schema public revoke truncate, trigger, references on tables from anon, authenticated;