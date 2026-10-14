begin;
set local lock_timeout = '3s';
set local statement_timeout = '10s';
lock table app.listings in access exclusive mode;
do $$
begin
  if exists(select 1 from app.listings) then
    raise exception 'Refusing to remove nonempty listings';
  end if;
end;
$$;
drop table app.listings;
commit;
