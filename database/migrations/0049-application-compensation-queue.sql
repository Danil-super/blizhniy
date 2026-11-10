-- Dormant TEST queue. No runtime grants, consumer startup or financial writes.
begin;
set local lock_timeout='3s';
set local statement_timeout='10s';
create table app.application_compensation_jobs (
 payment_intent_id uuid primary key references app.application_compensation_cases(payment_intent_id) on delete restrict,
 merchant_shop_id text not null check(merchant_shop_id ~ '^[a-zA-Z0-9_-]{1,64}$'),
 state text not null check(state in ('queued','processing','completed','blocked')),
 attempts integer not null default 0 check(attempts between 0 and 12),
 claim_id uuid unique,
 available_at timestamptz not null default clock_timestamp() check(isfinite(available_at)),
 last_code text check(last_code in ('provider_pending','provider_canceled','processing_unavailable','attempts_exhausted','source_unavailable')),
 check((state='processing')=(claim_id is not null)),
 check(state<>'completed' or last_code is null),
 check(state<>'blocked' or last_code is not null)
);
create index application_compensation_job_due on app.application_compensation_jobs(merchant_shop_id,available_at,payment_intent_id)
 where state in ('queued','processing');
create index application_compensation_case_scan on app.application_compensation_cases(merchant_shop_id,created_at,payment_intent_id);
create table app.application_compensation_queue_cursors (
 merchant_shop_id text primary key check(merchant_shop_id ~ '^[a-zA-Z0-9_-]{1,64}$'),
 after_created_at timestamptz not null default '-infinity' check(isfinite(after_created_at) or after_created_at='-infinity'),
 after_payment_id uuid not null default '00000000-0000-0000-0000-000000000000'
);
create function app.enqueue_application_compensation_case() returns trigger
 language plpgsql security definer set search_path='' as $$
begin
 insert into app.application_compensation_jobs(payment_intent_id,merchant_shop_id,state)
 values(new.payment_intent_id,new.merchant_shop_id,'queued') on conflict do nothing;
 return new;
end $$;
create trigger application_compensation_case_enqueue after insert on app.application_compensation_cases
 for each row execute function app.enqueue_application_compensation_case();

create function app.enqueue_application_compensation_batch(shop text,batch_limit integer) returns integer
 language plpgsql security definer set search_path='' as $$
declare cursor_row app.application_compensation_queue_cursors;item record;visited integer:=0;
begin
 if pg_catalog.current_setting('transaction_isolation')<>'read committed' or shop is null or shop !~ '^[a-zA-Z0-9_-]{1,64}$' or batch_limit is null or batch_limit not between 1 and 100 then
  raise exception 'Invalid compensation queue batch' using errcode='22023';end if;
 insert into app.application_compensation_queue_cursors(merchant_shop_id) values(shop) on conflict do nothing;
 select * into cursor_row from app.application_compensation_queue_cursors where merchant_shop_id=shop for update skip locked;
 if not found then return 0;end if;
 -- Keyset scan bounds visited history as well as inserted jobs; terminal history cannot starve new work.
 for item in select c.payment_intent_id,c.created_at from app.application_compensation_cases c
  where c.merchant_shop_id=shop and (c.created_at,c.payment_intent_id)>(cursor_row.after_created_at,cursor_row.after_payment_id)
  order by c.created_at,c.payment_intent_id limit batch_limit loop
  insert into app.application_compensation_jobs(payment_intent_id,merchant_shop_id,state)
   values(item.payment_intent_id,shop,case when exists(select 1 from app.application_compensation_refunds f where f.payment_intent_id=item.payment_intent_id and f.merchant_shop_id=shop) then 'completed' else 'queued' end)
   on conflict do nothing;
  cursor_row.after_created_at:=item.created_at;cursor_row.after_payment_id:=item.payment_intent_id;visited:=visited+1;
 end loop;
 if visited>0 then update app.application_compensation_queue_cursors set after_created_at=cursor_row.after_created_at,after_payment_id=cursor_row.after_payment_id where merchant_shop_id=shop;end if;
 return visited;
end $$;

create function app.claim_application_compensation_job(shop text) returns jsonb
 language plpgsql security definer set search_path='' as $$
declare job app.application_compensation_jobs;token uuid;
begin
 if pg_catalog.current_setting('transaction_isolation')<>'read committed' or shop is null or shop !~ '^[a-zA-Z0-9_-]{1,64}$' then
  raise exception 'Invalid compensation queue scope' using errcode='22023';end if;
 select * into job from app.application_compensation_jobs
  where merchant_shop_id=shop and state in ('queued','processing') and available_at<=pg_catalog.clock_timestamp()
  order by available_at,payment_intent_id limit 1 for update skip locked;
 if not found then return null;end if;
 -- A lost acknowledgement after applying the money needs no further provider call.
 if exists(select 1 from app.application_compensation_refunds where payment_intent_id=job.payment_intent_id and merchant_shop_id=shop) then
  update app.application_compensation_jobs set state='completed',claim_id=null,last_code=null where payment_intent_id=job.payment_intent_id;
  return pg_catalog.jsonb_build_object('state','completed');
 end if;
 if job.attempts>=12 then
  update app.application_compensation_jobs set state='blocked',claim_id=null,last_code='attempts_exhausted' where payment_intent_id=job.payment_intent_id;
  return pg_catalog.jsonb_build_object('state','blocked','code','attempts_exhausted');
 end if;
 token:=pg_catalog.gen_random_uuid();
 update app.application_compensation_jobs set state='processing',claim_id=token,attempts=attempts+1,available_at=pg_catalog.clock_timestamp()+interval '5 minutes' where payment_intent_id=job.payment_intent_id;
 return pg_catalog.jsonb_build_object('paymentIntentId',job.payment_intent_id,'claimId',token,'attempts',job.attempts+1);
end $$;

create function app.owns_application_compensation_job(shop text,payment_id uuid,token uuid) returns boolean
 language sql volatile security definer set search_path='' as $$
 select exists(select 1 from app.application_compensation_jobs where merchant_shop_id=shop and payment_intent_id=payment_id
  and claim_id=token and state='processing' and available_at>pg_catalog.clock_timestamp())
$$;
create function app.finish_application_compensation_job(shop text,payment_id uuid,token uuid,outcome text,code text) returns boolean
 language plpgsql security definer set search_path='' as $$
declare job app.application_compensation_jobs;
begin
 if pg_catalog.current_setting('transaction_isolation')<>'read committed' or outcome is null or outcome not in ('completed','retry','blocked') or
  (outcome='completed' and code is not null) or (outcome<>'completed' and (code is null or code not in ('provider_pending','provider_canceled','processing_unavailable','attempts_exhausted','source_unavailable'))) then
  raise exception 'Invalid compensation queue outcome' using errcode='22023';end if;
 select * into job from app.application_compensation_jobs where merchant_shop_id=shop and payment_intent_id=payment_id for update;
 if not found or job.state<>'processing' or job.claim_id is distinct from token or job.available_at<=pg_catalog.clock_timestamp() then return false;end if;
 if outcome='completed' and not exists(select 1 from app.application_compensation_refunds where payment_intent_id=payment_id and merchant_shop_id=shop) then
  raise exception 'Compensation completion requires the applied financial effect' using errcode='23514';end if;
 -- One final read-only claim checks a possibly committed effect before exhaustion.
 update app.application_compensation_jobs set state=case when outcome='retry' then 'queued' else outcome end,
  last_code=code,claim_id=null,
  available_at=case when outcome='retry' and attempts>=12 then pg_catalog.clock_timestamp() else
   pg_catalog.clock_timestamp()+pg_catalog.make_interval(secs=>least(3600,30*pg_catalog.power(2,attempts-1))::integer) end
  where payment_intent_id=payment_id and merchant_shop_id=shop and claim_id=token and state='processing' and available_at>pg_catalog.clock_timestamp();
 return found;
end $$;
create function app.assert_application_compensation_job(shop text,payment_id uuid,token uuid) returns void
 language plpgsql security definer set search_path='' as $$
declare job app.application_compensation_jobs;
begin
 if pg_catalog.current_setting('transaction_isolation')<>'read committed' then raise exception 'Compensation lease requires read committed' using errcode='PBQ01';end if;
 -- Financial locks precede this queue lock. Keep it until authorization/effect COMMIT.
 select * into job from app.application_compensation_jobs where merchant_shop_id=shop and payment_intent_id=payment_id for update;
 if not found or job.state<>'processing' or job.claim_id is distinct from token or job.available_at<=pg_catalog.clock_timestamp() then
  raise exception 'Compensation lease unavailable' using errcode='PBQ01';end if;
end $$;
revoke all on app.application_compensation_jobs,app.application_compensation_queue_cursors from public;
revoke all on function app.enqueue_application_compensation_case(),app.enqueue_application_compensation_batch(text,integer),app.claim_application_compensation_job(text),
 app.owns_application_compensation_job(text,uuid,uuid),app.finish_application_compensation_job(text,uuid,uuid,text,text),app.assert_application_compensation_job(text,uuid,uuid) from public;
commit;
