-- Explicit rollback for an empty, isolated/pre-launch schema ONLY. Never erase accounts.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '10s';
lock table app.users, app.sessions in access exclusive mode;
do $$
begin
  if exists (select 1 from app.users) or exists (select 1 from app.sessions) then
    raise exception 'Refusing identity rollback: accounts or sessions exist';
  end if;
end;
$$;
drop table app.sessions;
drop table app.users;
drop function app.guard_auth_version();
-- No CASCADE: later modules make rollback fail atomically instead of deleting their data.
drop schema app;
commit;
