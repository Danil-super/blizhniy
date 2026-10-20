-- Roll back only before enabling preference writes; never discard existing messenger choices.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '10s';
lock table app.listings in access exclusive mode;
do $$ begin
  if exists(select 1 from app.listings where contact_method<>'phone') then
    raise exception 'Contact preference rollback would discard data' using errcode='23514';
  end if;
end $$;
alter table app.listings drop column contact_method;
commit;
