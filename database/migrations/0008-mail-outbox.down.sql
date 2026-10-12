-- Refuse data loss and block concurrent inserts before checking emptiness.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '10s';
lock table app.mail_outbox in access exclusive mode;
do $$ begin
  if exists(select 1 from app.mail_outbox) then
    raise exception 'Refusing to drop nonempty mail outbox' using errcode='55000';
  end if;
end $$;
drop table app.mail_outbox;
commit;
