begin;
set local lock_timeout = '3s';
set local statement_timeout = '10s';
lock table app.work_publications,app.work_publication_photos,app.work_moderation in access exclusive mode;
do $$
begin
 if exists(select 1 from app.work_publications) or exists(select 1 from app.work_publication_photos) or exists(select 1 from app.work_moderation) then
  raise exception 'Refusing to remove nonempty work publications';
 end if;
end;
$$;
drop table app.work_moderation;
drop table app.work_publication_photos;
drop table app.work_publications;
commit;
