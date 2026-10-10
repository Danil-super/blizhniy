begin;
set local lock_timeout = '3s';
set local statement_timeout = '10s';
-- Same parent-before-attempt order as runtime, before deciding the journal is empty.
lock table app.media_objects,app.media_write_attempts in access exclusive mode;
do $$ begin
  if exists(select 1 from app.media_write_attempts) then
    raise exception 'Refusing to remove recorded media write attempts';
  end if;
end $$;
drop table app.media_write_attempts;
drop function app.guard_media_write_attempt();
commit;
