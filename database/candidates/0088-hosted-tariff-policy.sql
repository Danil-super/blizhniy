-- Candidate for the separate app_admin journal. No installation or permission grants.
begin;
set local lock_timeout='3s';
set local statement_timeout='10s';

alter table app_admin.migrations drop constraint migrations_name_check,
 add constraint migrations_name_check check(name in (
  '0061-admin-user-access.sql','0062-admin-tariffs.sql','0088-hosted-tariff-policy.sql'
 ));

create function app_admin.hosted_tariff_access(p_session_hash text,p_actor uuid,p_action text,p_target text,p_operation uuid,
 p_expected text,p_name text,p_price text,p_duration integer,p_active boolean,p_reason text) returns jsonb
 language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare
 answer jsonb;
 receipt jsonb;
 tariff_action text;
begin
 answer:=app_admin.tariff_access(p_session_hash,p_actor,p_action,p_target,p_operation,p_expected,p_name,p_price,p_duration,p_active,p_reason);
 if p_action='change' then
  receipt:=answer->'receipt';
  tariff_action:=receipt->'next'->>'action';
  -- A policy refusal rolls back the tariff and its receipt in the same statement.
  if tariff_action is null or tariff_action not in ('listing_publication','vacancy_publication','work_request_publication',
    'specialist_publication','job_response','ad_marquee') or
   receipt->'next'->>'name' is distinct from receipt->'previous'->>'name' or
   (p_active and p_price::numeric=0) or
   ((tariff_action='job_response') is distinct from (p_duration is null)) then
   raise exception using errcode='PTA09',message='Unsupported hosted tariff terms';
  end if;
 end if;
 return answer;
end;
$$;
revoke all on function app_admin.hosted_tariff_access(text,uuid,text,text,uuid,text,text,text,integer,boolean,text) from public;
commit;
