-- Dormant TEST lease budget. Preserve the existing void admission API and its grants.
begin;
set local lock_timeout='3s';
set local statement_timeout='10s';
create function app.assert_application_compensation_job_remaining(shop text,payment_id uuid,token uuid) returns integer
 language plpgsql security definer set search_path='' as $$
declare remaining integer;
begin
 perform app.assert_application_compensation_job(shop,payment_id,token);
 -- The original guard holds this row until COMMIT; use wall clock after any wait.
 select pg_catalog.floor(extract(epoch from (available_at-pg_catalog.clock_timestamp()))*1000)::integer into remaining
  from app.application_compensation_jobs where merchant_shop_id=shop and payment_intent_id=payment_id and claim_id=token and state='processing';
 if remaining is null or remaining not between 1 and 300000 then raise exception 'Compensation lease unavailable' using errcode='PBQ01';end if;
 return remaining;
end $$;
revoke all on function app.assert_application_compensation_job_remaining(text,uuid,uuid) from public;
commit;
