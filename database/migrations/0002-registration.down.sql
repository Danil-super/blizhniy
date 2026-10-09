-- No CASCADE and no removal of populated registration records.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '10s';
lock table app.users, app.email_confirmations, app.registration_legal in access exclusive mode;
do $$
begin
  if exists (select 1 from app.registration_legal) or exists (select 1 from app.email_confirmations) then
    raise exception 'Refusing to remove populated registration data';
  end if;
end;
$$;
drop table app.email_confirmations, app.registration_legal;
commit;
