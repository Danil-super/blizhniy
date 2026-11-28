-- Roll back the candidate with the operator stopped. Preserves users and access receipts.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '10s';

drop function app_admin.user_access(text,uuid,text,uuid,uuid,bigint,text,boolean,text);
alter function app_admin.user_access_before_passkey(text,uuid,text,uuid,uuid,bigint,text,boolean,text)
  rename to user_access;
revoke all on function app_admin.user_access(text,uuid,text,uuid,uuid,bigint,text,boolean,text) from public;
grant execute on function app_admin.user_access(text,uuid,text,uuid,uuid,bigint,text,boolean,text) to blizhniy_user_operator;
drop table app_admin_passkey.user_access_permits;

commit;
