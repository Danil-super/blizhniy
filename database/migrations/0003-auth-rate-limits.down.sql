begin;
set local lock_timeout = '3s';
set local statement_timeout = '10s';
lock table app.auth_rate_limits in access exclusive mode;
do $$
begin
  if exists (select 1 from app.auth_rate_limits) then
    raise exception 'Refusing to remove populated rate limits';
  end if;
end;
$$;
drop table app.auth_rate_limits;
commit;
