-- Run with psql -X -v ON_ERROR_STOP=1 --single-transaction -f this_file.sql.
-- Temporary tables take precedence in the isolated fixture test; in production
-- these names resolve to public.listings and public.vacancies.
set local search_path = pg_temp, public;
set local lock_timeout = '3s';
set local statement_timeout = '30s';

with expired_rows as (
  update listings
     set status = 'expired'
   where status = 'published'
     and expires_at <= now()
  returning id
)
select 'listings' as entity, count(*) as expired_count from expired_rows;

with expired_rows as (
  update vacancies
     set status = 'expired'
   where status = 'published'
     and expires_at <= now()
  returning id
)
select 'vacancies' as entity, count(*) as expired_count from expired_rows;

-- A failed postcondition aborts the surrounding --single-transaction run.
do $$
begin
  if exists (select 1 from listings where status = 'published' and expires_at <= now())
     or exists (select 1 from vacancies where status = 'published' and expires_at <= now()) then
    raise exception 'Expired published rows remain after reconciliation';
  end if;
end $$;
