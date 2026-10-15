begin;
set local lock_timeout = '3s';
set local statement_timeout = '10s';
lock table app.listing_moderation in access exclusive mode;
do $$
begin
  if exists(select 1 from app.listing_moderation) then
    raise exception 'Refusing to remove nonempty listing moderation';
  end if;
end;
$$;
drop table app.listing_moderation;
commit;
