-- Only empty reference tables may be removed; no CASCADE or automatic seed deletion.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '10s';
lock table app.regions, app.cities, app.categories, app.specialist_categories, app.tariffs in access exclusive mode;
do $$
begin
  if exists (select 1 from app.regions) or exists (select 1 from app.cities)
     or exists (select 1 from app.categories) or exists (select 1 from app.specialist_categories)
     or exists (select 1 from app.tariffs) then
    raise exception 'Refusing to remove populated reference data';
  end if;
end;
$$;
drop table app.tariffs, app.specialist_categories, app.categories, app.cities, app.regions;
commit;
