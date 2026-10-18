begin;
set local lock_timeout = '3s';
set local statement_timeout = '10s';
lock table app.service_publications,app.service_publication_photos,app.service_moderation in access exclusive mode;
do $$ begin
 if exists(select 1 from app.service_publications) or exists(select 1 from app.service_publication_photos) or exists(select 1 from app.service_moderation) then
  raise exception 'Refusing to remove nonempty service publications';
 end if;
end $$;
drop table app.service_moderation;
drop table app.service_publication_photos;
drop table app.service_publications;
commit;
