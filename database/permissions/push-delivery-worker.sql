begin;
do $$
declare worker oid;
begin
 select oid into worker from pg_catalog.pg_roles where rolname='blizhniy_push_worker'
  and rolcanlogin and not (rolsuper or rolcreatedb or rolcreaterole or rolinherit or rolreplication or rolbypassrls);
 if worker is null or exists(select 1 from pg_catalog.pg_auth_members where member=worker) then
  raise exception 'A dedicated unprivileged push delivery login is required';
 end if;
 execute format('grant connect on database %I to blizhniy_push_worker',current_database());
end $$;
grant usage on schema app_push to blizhniy_push_worker;
grant execute on function app_push.claim_delivery(uuid),
 app_push.finish_delivery(uuid,uuid,text,integer),app_push.sweep_delivery() to blizhniy_push_worker;
commit;
