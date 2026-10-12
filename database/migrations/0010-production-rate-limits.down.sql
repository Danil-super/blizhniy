-- No counter deletion or truncation to make a rollback pass.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '10s';
do $$
begin
  if exists(select 1 from app.auth_rate_limits where attempts > 61) then
    raise exception 'Refusing to narrow populated production rate counters';
  end if;
end;
$$;
alter table app.auth_rate_limits
  drop constraint auth_rate_limits_production_attempts_check,
  add constraint auth_rate_limits_attempts_check check (attempts between 1 and 61);
commit;
