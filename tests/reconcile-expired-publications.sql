-- Execute only on an isolated staging PostgreSQL connection:
-- psql -X -v ON_ERROR_STOP=1 -d "$STAGING_DATABASE_URL" -f tests/reconcile-expired-publications.sql
-- pg_temp shadows public so the tested maintenance file cannot update real rows.
begin;

create temp table listings (
  id integer primary key,
  status text not null,
  is_paid boolean not null,
  published_at timestamptz,
  expires_at timestamptz
) on commit drop;
create temp table vacancies (like listings including all) on commit drop;

insert into listings (id, status, is_paid, published_at, expires_at) values
  (1, 'published', true,  now() - interval '31 days', now() - interval '1 day'),
  (2, 'published', true,  now() - interval '1 day', now() + interval '1 day'),
  (3, 'archived',  true,  now() - interval '31 days', now() - interval '1 day'),
  (4, 'published', true,  now() - interval '31 days', null),
  (5, 'published', false, now() - interval '31 days', now());
insert into vacancies (id, status, is_paid, published_at, expires_at) values
  (1, 'published', true, now() - interval '31 days', now() - interval '1 day'),
  (2, 'published', true, now() - interval '1 day', now() + interval '1 day'),
  (3, 'archived',  true, now() - interval '31 days', now() - interval '1 day'),
  (4, 'published', true, now() - interval '31 days', null);

\ir ../supabase/maintenance/reconcile-expired-publications.sql

do $$
begin
  if (select count(*) from listings where status = 'expired') <> 2
    or (select count(*) from vacancies where status = 'expired') <> 1
    or (select count(*) from listings where status = 'published') <> 2
    or (select count(*) from vacancies where status = 'published') <> 2
    or (select count(*) from listings where status = 'archived') <> 1
    or (select count(*) from vacancies where status = 'archived') <> 1
    or (select count(*) from listings where is_paid) <> 4
    or (select count(*) from vacancies where is_paid) <> 4
    or (select count(*) from listings where id = 1 and published_at = now() - interval '31 days' and expires_at = now() - interval '1 day') <> 1
  then
    raise exception 'Expiry reconciliation changed an unexpected row or payment history';
  end if;
end $$;

-- A second run must not change any rows.
\ir ../supabase/maintenance/reconcile-expired-publications.sql

do $$
begin
  if (select count(*) from listings where status = 'expired') <> 2
    or (select count(*) from vacancies where status = 'expired') <> 1
  then
    raise exception 'Expiry reconciliation is not idempotent';
  end if;
end $$;

rollback;
