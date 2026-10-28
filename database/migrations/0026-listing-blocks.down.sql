begin;
set local lock_timeout = '3s';
lock table app.listing_blocks,app.listing_block_mail in access exclusive mode;
do $$ begin
 if exists(select 1 from app.listing_blocks) or exists(select 1 from app.listing_block_mail) then
  raise exception 'Refusing to remove nonempty listing blocks' using errcode='55000';
 end if;
end $$;
drop table app.listing_block_mail;
drop table app.listing_blocks;
commit;
