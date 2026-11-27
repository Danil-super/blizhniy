begin;
do $$
declare monitor oid;
begin
 select r.oid into monitor from pg_catalog.pg_roles r where r.rolname='blizhniy_queue_monitor'
  and r.rolcanlogin and not (r.rolsuper or r.rolcreatedb or r.rolcreaterole or r.rolinherit or r.rolreplication or r.rolbypassrls);
 if monitor is null or exists(select 1 from pg_catalog.pg_auth_members where member=monitor or roleid=monitor) then
  raise exception 'A dedicated unprivileged queue monitor login is required';
 end if;
 execute format('grant connect on database %I to blizhniy_queue_monitor',current_database());
end $$;
grant usage on schema operations_health to blizhniy_queue_monitor;
grant execute on function operations_health.queue_backlog(text) to blizhniy_queue_monitor;
commit;
