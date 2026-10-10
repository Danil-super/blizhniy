begin;
set local lock_timeout = '3s';
set local statement_timeout = '10s';
lock table app.media_objects,app.media_storage_budget in access exclusive mode;
do $$ begin
  if exists(select 1 from app.media_objects) or exists(select 1 from app.media_storage_budget where charged_bytes<>0 or charged_objects<>0) then
    raise exception 'Refusing to remove media reservations or outstanding capacity';
  end if;
end $$;
drop table app.media_objects;
drop function app.charge_media_reservation();
drop function app.guard_media_record();
drop table app.media_storage_budget;
commit;
