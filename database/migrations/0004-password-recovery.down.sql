-- Roll back only an empty recovery table. Never remove users, sessions or populated links.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '10s';
lock table app.users, app.password_recoveries in access exclusive mode;
do $$
begin
  if exists (select 1 from app.password_recoveries) then
    raise exception 'Refusing to remove populated recovery data';
  end if;
end;
$$;
drop table app.password_recoveries;
commit;
