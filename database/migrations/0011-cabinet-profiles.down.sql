begin;
set local lock_timeout = '3s';
set local statement_timeout = '10s';
lock table app.cabinet_profiles in access exclusive mode;
do $$
begin
  if exists(select 1 from app.cabinet_profiles) then
    raise exception 'Refusing to remove nonempty cabinet profiles';
  end if;
end;
$$;
drop table app.cabinet_profiles;
commit;
