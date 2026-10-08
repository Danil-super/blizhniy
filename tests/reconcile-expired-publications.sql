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
create temp table work_requests (like listings including all) on commit drop;

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
insert into work_requests (id, status, is_paid, published_at, expires_at) values
  (1, 'published', true, now() - interval '31 days', now() - interval '1 day'),
  (2, 'published', true, now() - interval '1 day', now() + interval '1 day'),
  (3, 'archived', true, now() - interval '31 days', now() - interval '1 day'),
  (4, 'published', false, now() - interval '31 days', null),
  (5, 'published', false, now() - interval '31 days', now());

\ir ../supabase/maintenance/reconcile-expired-publications.sql

do $$
begin
  if (select count(*) from listings where status = 'expired') <> 2
    or (select count(*) from vacancies where status = 'expired') <> 1
    or (select count(*) from work_requests where status = 'expired') <> 2
    or (select count(*) from work_requests where status = 'published') <> 2
    or (select count(*) from work_requests where is_paid) <> 3
    or not exists (select 1 from work_requests where id = 1 and published_at = now() - interval '31 days' and expires_at = now() - interval '1 day')
    or not exists (select 1 from work_requests where id = 4 and status = 'published' and not is_paid and expires_at is null)
    or not exists (select 1 from work_requests where id = 3 and status = 'archived')
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
    or (select count(*) from work_requests where status = 'expired') <> 2
  then
    raise exception 'Expiry reconciliation is not idempotent';
  end if;
end $$;

rollback;
