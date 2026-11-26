begin;
do $$
declare worker oid;
begin
 select oid into worker from pg_catalog.pg_roles where rolname='blizhniy_business_email'
  and rolcanlogin and not (rolsuper or rolcreatedb or rolcreaterole or rolinherit or rolreplication or rolbypassrls);
 if worker is null or exists(select 1 from pg_catalog.pg_auth_members where member=worker) then
  raise exception 'A dedicated unprivileged business email login is required';
 end if;
 execute format('grant connect on database %I to blizhniy_business_email',current_database());
end $$;
grant usage on schema notification_delivery to blizhniy_business_email;
grant execute on function notification_delivery.claim_business_email(uuid),
 notification_delivery.finish_business_email(uuid,uuid,text),notification_delivery.sweep_business_email()
 to blizhniy_business_email;
commit;
