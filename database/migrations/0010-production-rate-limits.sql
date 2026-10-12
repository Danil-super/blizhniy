-- Production namespaces count up to 2000; local limits remain 60/5 in application code.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '10s';
alter table app.auth_rate_limits
  drop constraint auth_rate_limits_attempts_check,
  add constraint auth_rate_limits_production_attempts_check check (attempts between 1 and 2001);
commit;
