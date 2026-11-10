-- Dormant TEST approved placement queue and refund notices. No grants or consumer startup.
begin;
set local lock_timeout='3s';
set local statement_timeout='10s';
create table app.placement_refund_jobs (
 approval_id uuid primary key references app.payment_refund_approvals(id) on delete restrict,
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
create index placement_refund_job_due on app.placement_refund_jobs(merchant_shop_id,available_at,approval_id)
 where state in ('queued','processing');
create index placement_refund_approval_scan on app.payment_refund_approvals(approved_at,id);
create table app.placement_refund_queue_cursors (
 merchant_shop_id text primary key check(merchant_shop_id ~ '^[a-zA-Z0-9_-]{1,64}$'),
 after_created_at timestamptz not null default '-infinity' check(isfinite(after_created_at) or after_created_at='-infinity'),
 after_approval uuid not null default '00000000-0000-0000-0000-000000000000'
);
create function app.enqueue_placement_refund_approval() returns trigger
 language plpgsql security definer set search_path='' as $$
begin
 insert into app.placement_refund_jobs(approval_id,merchant_shop_id,state)
 select new.id,i.merchant_shop_id,'queued' from app.payment_checkout_intents i where i.id=new.payment_intent_id and i.is_test on conflict do nothing;
 return new;
end $$;
create trigger placement_refund_approval_enqueue after insert on app.payment_refund_approvals
 for each row execute function app.enqueue_placement_refund_approval();

create function app.enqueue_placement_refund_batch(shop text,batch_limit integer) returns integer
 language plpgsql security definer set search_path='' as $$
declare cursor_row app.placement_refund_queue_cursors;item record;visited integer:=0;
begin
 if pg_catalog.current_setting('transaction_isolation')<>'read committed' or shop is null or shop !~ '^[a-zA-Z0-9_-]{1,64}$' or batch_limit is null or batch_limit not between 1 and 100 then
  raise exception 'Invalid placement refund queue batch' using errcode='22023';end if;
 insert into app.placement_refund_queue_cursors(merchant_shop_id) values(shop) on conflict do nothing;
 select * into cursor_row from app.placement_refund_queue_cursors where merchant_shop_id=shop for update skip locked;
 if not found then return 0;end if;
 -- Keyset scan bounds visited history as well as inserted jobs; terminal history cannot starve new work.
 for item in select c.id as approval_id,c.approved_at as created_at from app.payment_refund_approvals c
  where (c.approved_at,c.id)>(cursor_row.after_created_at,cursor_row.after_approval)
  order by c.approved_at,c.id limit batch_limit loop
  insert into app.placement_refund_jobs(approval_id,merchant_shop_id,state)
   select item.approval_id,shop,case when exists(select 1 from app.payment_refund_effects f where f.operation_id=item.approval_id and f.merchant_shop_id=shop) then 'completed' else 'queued' end
    from app.payment_refund_approvals a join app.payment_checkout_intents i on i.id=a.payment_intent_id
    where a.id=item.approval_id and i.merchant_shop_id=shop and i.is_test
   on conflict do nothing;
  cursor_row.after_created_at:=item.created_at;cursor_row.after_approval:=item.approval_id;visited:=visited+1;
 end loop;
 if visited>0 then update app.placement_refund_queue_cursors set after_created_at=cursor_row.after_created_at,after_approval=cursor_row.after_approval where merchant_shop_id=shop;end if;
 return visited;
end $$;

create function app.claim_placement_refund_job(shop text) returns jsonb
 language plpgsql security definer set search_path='' as $$
declare job app.placement_refund_jobs;token uuid;
begin
 if pg_catalog.current_setting('transaction_isolation')<>'read committed' or shop is null or shop !~ '^[a-zA-Z0-9_-]{1,64}$' then
  raise exception 'Invalid placement refund queue scope' using errcode='22023';end if;
 select * into job from app.placement_refund_jobs
  where merchant_shop_id=shop and state in ('queued','processing') and available_at<=pg_catalog.clock_timestamp()
  order by available_at,approval_id limit 1 for update skip locked;
 if not found then return null;end if;
 -- A lost acknowledgement after applying the money needs no further provider call.
 if exists(select 1 from app.payment_refund_effects where operation_id=job.approval_id and merchant_shop_id=shop) then
  update app.placement_refund_jobs set state='completed',claim_id=null,last_code=null where approval_id=job.approval_id;
  return pg_catalog.jsonb_build_object('state','completed');
 end if;
 if job.attempts>=12 then
  update app.placement_refund_jobs set state='blocked',claim_id=null,last_code='attempts_exhausted' where approval_id=job.approval_id;
  return pg_catalog.jsonb_build_object('state','blocked','code','attempts_exhausted');
 end if;
 token:=pg_catalog.gen_random_uuid();
 update app.placement_refund_jobs set state='processing',claim_id=token,attempts=attempts+1,available_at=pg_catalog.clock_timestamp()+interval '5 minutes' where approval_id=job.approval_id;
 return pg_catalog.jsonb_build_object('approvalId',job.approval_id,'claimId',token,'attempts',job.attempts+1);
end $$;

create function app.owns_placement_refund_job(shop text,approval uuid,token uuid) returns boolean
 language sql volatile security definer set search_path='' as $$
 select exists(select 1 from app.placement_refund_jobs where merchant_shop_id=shop and approval_id=approval
  and claim_id=token and state='processing' and available_at>pg_catalog.clock_timestamp())
$$;
create function app.finish_placement_refund_job(shop text,approval uuid,token uuid,outcome text,code text) returns boolean
 language plpgsql security definer set search_path='' as $$
declare job app.placement_refund_jobs;
begin
 if pg_catalog.current_setting('transaction_isolation')<>'read committed' or outcome is null or outcome not in ('completed','retry','blocked') or
  (outcome='completed' and code is not null) or (outcome<>'completed' and (code is null or code not in ('provider_pending','provider_canceled','processing_unavailable','attempts_exhausted','source_unavailable'))) then
  raise exception 'Invalid placement refund queue outcome' using errcode='22023';end if;
 select * into job from app.placement_refund_jobs where merchant_shop_id=shop and approval_id=approval for update;
 if not found or job.state<>'processing' or job.claim_id is distinct from token or job.available_at<=pg_catalog.clock_timestamp() then return false;end if;
 if outcome='completed' and not exists(select 1 from app.payment_refund_effects where operation_id=approval and merchant_shop_id=shop) then
  raise exception 'Placement refund completion requires the applied financial effect' using errcode='23514';end if;
 -- One final read-only claim checks a possibly committed effect before exhaustion.
 update app.placement_refund_jobs set state=case when outcome='retry' then 'queued' else outcome end,
  last_code=code,claim_id=null,
  available_at=case when outcome='retry' and attempts>=12 then pg_catalog.clock_timestamp() else
   pg_catalog.clock_timestamp()+pg_catalog.make_interval(secs=>least(3600,30*pg_catalog.power(2,attempts-1))::integer) end
  where approval_id=approval and merchant_shop_id=shop and claim_id=token and state='processing' and available_at>pg_catalog.clock_timestamp();
 return found;
end $$;
create function app.assert_placement_refund_job(shop text,approval uuid,token uuid) returns integer
 language plpgsql security definer set search_path='' as $$
declare job app.placement_refund_jobs;
begin
 if pg_catalog.current_setting('transaction_isolation')<>'read committed' then raise exception 'Placement refund lease requires read committed' using errcode='PRQ01';end if;
 -- Financial locks precede this queue lock. Keep it until authorization/effect COMMIT.
 select * into job from app.placement_refund_jobs where merchant_shop_id=shop and approval_id=approval for update;
 if not found or job.state<>'processing' or job.claim_id is distinct from token or job.available_at<=pg_catalog.clock_timestamp() then
  raise exception 'Placement refund lease unavailable' using errcode='PRQ01';end if;
 return pg_catalog.floor(extract(epoch from (job.available_at-pg_catalog.clock_timestamp()))*1000)::integer;
end $$;
revoke all on app.placement_refund_jobs,app.placement_refund_queue_cursors from public;
revoke all on function app.enqueue_placement_refund_approval(),app.enqueue_placement_refund_batch(text,integer),app.claim_placement_refund_job(text),
 app.owns_placement_refund_job(text,uuid,uuid),app.finish_placement_refund_job(text,uuid,uuid,text,text),app.assert_placement_refund_job(text,uuid,uuid) from public;
create function app.notify_placement_refund() returns trigger
 language plpgsql security definer set search_path='' as $$
begin
 -- Missing historical payers must not make an otherwise valid financial effect fail.
 insert into app.notifications(user_id,event_key,category,tone,title,body,action_href)
  select p.owner_id,'placement_refund:'||p.id::text,'payment','success','Возврат платы за размещение',
   'Плата за размещение возвращена.'||case when a.id is not null then ' Причина: '||a.reason else '' end,
   case p.target_type when 'listing' then '/cabinet/obyavleniya' when 'vacancy' then '/cabinet/vakansii' else '/cabinet/zakazy' end
  from app.payment_checkout_intents p join app.users u on u.id=p.owner_id left join app.payment_refund_approvals a on a.id=new.operation_id and a.payment_intent_id=p.id
  where p.id=new.payment_intent_id on conflict(user_id,event_key) do nothing;
 return new;
end $$;
create trigger placement_refund_notify after insert on app.payment_refund_effects for each row execute function app.notify_placement_refund();
alter table app.payment_refund_effects enable always trigger placement_refund_notify;
create function app.finish_placement_refund_recovery_job() returns trigger
 language plpgsql security definer set search_path='' as $$
begin
 if new.phase in ('succeeded','canceled') then
  update app.placement_refund_jobs set state=case when new.phase='succeeded' then 'completed' else 'blocked' end,claim_id=null,
   last_code=case when new.phase='canceled' then 'provider_canceled' else null end
   where approval_id=new.operation_id and merchant_shop_id=new.merchant_shop_id and state<>'completed'
    and exists(select 1 from app.payment_refund_approvals a where a.id=new.operation_id and a.payment_intent_id=new.payment_intent_id)
    and (new.phase<>'succeeded' or exists(select 1 from app.payment_refund_effects e where e.operation_id=new.operation_id
     and e.payment_intent_id=new.payment_intent_id and e.provider_refund_id=new.provider_refund_id and e.merchant_shop_id=new.merchant_shop_id));
 end if;
 if app.refund_recovery_actor()<>new.operator_id then raise exception 'Administrator changed' using errcode='42501';end if;
 return new;
end $$;
create trigger placement_refund_recovery_finish after insert on app.payment_refund_recovery_actions for each row execute function app.finish_placement_refund_recovery_job();
alter table app.payment_refund_recovery_actions enable always trigger placement_refund_recovery_finish;
revoke all on function app.notify_placement_refund(),app.finish_placement_refund_recovery_job() from public;
commit;
