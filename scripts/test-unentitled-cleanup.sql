-- Run in a disposable/staging database with psql -v ON_ERROR_STOP=1 -f.
-- This script rolls back every write, including synthetic successful payments.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '90s';

do $assert_fixture$
begin
  if (select count(*) from public.specialist_profiles where status = 'published') <> 3
    or (select count(*) from public.work_requests where status = 'published') <> 7
  then
    raise exception 'Publication fixture changed; review aggregate entitlement counts before cleanup';
  end if;
end
$assert_fixture$;

create temporary table smoke_protected_targets on commit drop as
select 'specialist'::text target_type, id, user_id owner_id
from public.specialist_profiles
where status = 'published'
order by id
limit 1;

insert into smoke_protected_targets (target_type, id, owner_id)
select 'workRequest', id, author_id
from public.work_requests
where status = 'published'
order by id
limit 1;

do $assert_targets$
begin
  if (select count(*) from smoke_protected_targets) <> 2 then
    raise exception 'Two published smoke targets required';
  end if;
end
$assert_targets$;

insert into public.payments (
  user_id, tariff_id, target_type, target_id, provider,
  provider_payment_id, amount, status, paid_at
)
select target.owner_id, tariff.id, target.target_type, target.id, 'yookassa',
       'synthetic-cleanup-smoke-' || gen_random_uuid()::text,
       tariff.price, 'succeeded'::public.payment_status, now() - interval '1 day'
from smoke_protected_targets target
join public.tariffs tariff
  on tariff.action = case when target.target_type = 'specialist'
    then 'specialist_publication'::public.tariff_action
    else 'work_request_publication'::public.tariff_action end;

\i supabase/migrations/20260927090646_demote_unentitled_test_publications_20260927.sql
\i supabase/migrations/20260927090646_demote_unentitled_test_publications_20260927.sql

do $assert_cleanup$
begin
  if exists (
    select 1 from smoke_protected_targets target
    left join public.specialist_profiles s on s.id = target.id and target.target_type = 'specialist'
    left join public.work_requests w on w.id = target.id and target.target_type = 'workRequest'
    where coalesce(s.status, w.status) <> 'published'::public.publication_status
  ) then
    raise exception 'Active paid publication was demoted';
  end if;

  if (select count(*) from public.specialist_profiles where status = 'published') <> 1
    or (select count(*) from public.work_requests where status = 'published') <> 1
    or (select count(*) from public.specialist_profiles where status = 'draft') < 2
  then
    raise exception 'Unentitled published rows remain or protected row was changed';
  end if;

  if exists (
    select 1 from public.work_requests w
    join public.payments p on p.target_type = 'workRequest' and p.target_id = w.id
      and p.user_id = w.author_id and p.provider = 'yookassa'
      and p.status = 'succeeded'::public.payment_status
    where w.status = 'published' and w.id not in (
      select id from smoke_protected_targets where target_type = 'workRequest'
    )
  ) then
    raise exception 'Expired paid work request remained published';
  end if;
end
$assert_cleanup$;

select 'cleanup_transaction_tests_passed' result;
rollback;
