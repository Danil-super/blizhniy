-- Dormant TEST discovery. Candidate selection is not compensation admission.
begin;
set local lock_timeout='3s';
set local statement_timeout='10s';
create table app.application_compensation_discovery (
 merchant_shop_id text primary key check(merchant_shop_id ~ '^[a-zA-Z0-9_-]{1,64}$'),
 after_created_at timestamptz not null default '-infinity' check(isfinite(after_created_at) or after_created_at='-infinity'),
 after_payment_id uuid not null default '00000000-0000-0000-0000-000000000000',
 sweep_until timestamptz check(isfinite(sweep_until)),
 next_scan_at timestamptz not null default clock_timestamp() check(isfinite(next_scan_at))
);
create index application_compensation_discovery_source on app.payment_checkout_intents(merchant_shop_id,created_at,id)
 where is_test and target_type='application';
create function app.next_application_compensation_candidates(shop text,batch_limit integer) returns jsonb
 language plpgsql security definer set search_path='' as $$
declare cursor_row app.application_compensation_discovery;item record;visited integer:=0;ids uuid[]:=array[]::uuid[];
begin
 if pg_catalog.current_setting('transaction_isolation')<>'read committed' or shop is null or shop !~ '^[a-zA-Z0-9_-]{1,64}$' or batch_limit is null or batch_limit not between 1 and 25 then
  raise exception 'Invalid compensation discovery batch' using errcode='22023';end if;
 insert into app.application_compensation_discovery(merchant_shop_id) values(shop) on conflict do nothing;
 select * into cursor_row from app.application_compensation_discovery where merchant_shop_id=shop for update skip locked;
 if not found or cursor_row.next_scan_at>pg_catalog.clock_timestamp() then return pg_catalog.jsonb_build_object('visited',0,'ids',ids);end if;
 if cursor_row.sweep_until is null then cursor_row.sweep_until:=pg_catalog.clock_timestamp();end if;
 -- Bound the raw page before checking payment state: unpaid/old cases cannot create an unbounded anti-join scan.
 for item in select id,created_at from app.payment_checkout_intents where merchant_shop_id=shop and is_test and target_type='application'
  and (created_at,id)>(cursor_row.after_created_at,cursor_row.after_payment_id) and created_at<=cursor_row.sweep_until
  order by created_at,id limit batch_limit loop
  visited:=visited+1;cursor_row.after_created_at:=item.created_at;cursor_row.after_payment_id:=item.id;
  if not exists(select 1 from app.application_compensation_cases where payment_intent_id=item.id) and exists(
   select 1 from app.payment_orders o join app.payment_verifications v on v.intent_id=o.id
   join app.payment_provider_links p on p.intent_id=v.intent_id and p.provider_payment_id=v.provider_payment_id
   where o.id=item.id and o.status='succeeded' and v.status='succeeded' and v.captured_at is not null) then
   ids:=pg_catalog.array_append(ids,item.id);
  end if;
 end loop;
 if visited=0 then
  update app.application_compensation_discovery set after_created_at='-infinity',after_payment_id='00000000-0000-0000-0000-000000000000',sweep_until=null,
   next_scan_at=pg_catalog.clock_timestamp()+interval '60 seconds' where merchant_shop_id=shop;
 else
  update app.application_compensation_discovery set after_created_at=cursor_row.after_created_at,after_payment_id=cursor_row.after_payment_id,
   sweep_until=cursor_row.sweep_until where merchant_shop_id=shop;
 end if;
 return pg_catalog.jsonb_build_object('visited',visited,'ids',ids);
end $$;
revoke all on app.application_compensation_discovery from public;
revoke all on function app.next_application_compensation_candidates(text,integer) from public;
commit;
