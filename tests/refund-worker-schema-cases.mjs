import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import pg from 'pg';
import {getRefundWorkerRolePlan} from '../scripts/refund-worker-role.mjs';
import {readRefundSchema} from '../scripts/refund-worker-schema.mjs';

// Reference comes only from the explicit trusted sources in an owned disposable container.
export async function testRefundSchemaReference(suite,admin,db){
 await suite.test('schema fingerprint is pinned to a fresh complete migration replay under a different owner',async()=>{
  await admin.query('create role refund_schema_owner nologin');
  await admin.query('create database refund_schema_reference owner refund_schema_owner');
  const reference=new pg.Client({...admin.options,password:admin.options.password,database:'refund_schema_reference'});
  try{
   await reference.connect();await reference.query('set role refund_schema_owner');
   for(const {name,sha256} of getRefundWorkerRolePlan('blizhniy_test').journal){
    const source=await readFile(new URL('../database/migrations/'+name,import.meta.url),'utf8');
    assert.equal(createHash('sha256').update(source).digest('hex'),sha256);
    await reference.query(source);
   }
   await reference.query('begin read only;set local search_path=pg_catalog');
   const fingerprint=await readRefundSchema(reference);
   assert.deepEqual(fingerprint,JSON.parse(await readFile(new URL('../database/refund-schema-0054.json',import.meta.url),'utf8')));
   assert.deepEqual(await db.transaction(readRefundSchema,{readOnly:true}),fingerprint);
   await reference.query("set local IntervalStyle='iso_8601';set local DateStyle='SQL, DMY';set local TimeZone='Europe/Moscow';set local quote_all_identifiers=on;set local standard_conforming_strings=off");
   assert.deepEqual(await readRefundSchema(reference),fingerprint);
   await reference.query('commit');
  }finally{await reference.end();await admin.query('drop database refund_schema_reference');await admin.query('drop role refund_schema_owner');}
 });
}

export async function testRefundSchemaDrift(suite,admin,check){
 const definition=async signature=>(await admin.query('select pg_get_functiondef($1::regprocedure) as sql',[signature])).rows[0].sql;
 const functionBody=await definition('app.refund_target_admitted(uuid,uuid)');
 const claim=await definition('app.claim_placement_refund_job(text)');
 const constraint='payment_refund_reservations_amount_check';
 const originalConstraint=(await admin.query('select pg_get_constraintdef(oid) as sql from pg_constraint where conrelid=$1::regclass and conname=$2',['app.payment_refund_reservations',constraint])).rows[0].sql;
 const fk=(await admin.query("select conname,pg_get_constraintdef(oid) as sql from pg_constraint where conrelid='app.payment_refund_reservations'::regclass and contype='f' order by conname limit 1")).rows[0];
 const trigger=(await admin.query("select pg_get_triggerdef(oid) as sql from pg_trigger where tgrelid='app.payment_refund_requests'::regclass and tgname='refund_request_guard'")).rows[0].sql;
 const journal=async()=>(await admin.query('select name,sha256 from blizhniy_meta.migrations order by name')).rows;
 const originalJournal=await journal();
 const changes=[
  ['changed private business function body',"create or replace function app.refund_target_admitted(payment_id uuid,operation uuid) returns boolean language plpgsql security definer set search_path='' as $$begin return true;end$$",functionBody],
  ['changed queue function security mode','alter function app.claim_placement_refund_job(text) security invoker',claim],
  ['changed queue search path',"alter function app.claim_placement_refund_job(text) set search_path=public",claim],
  ['disabled business trigger','alter table app.payment_refund_requests disable trigger refund_request_guard','alter table app.payment_refund_requests enable trigger refund_request_guard'],
  ['repointed business trigger','drop trigger refund_request_guard on app.payment_refund_requests;create trigger refund_request_guard before insert or update or delete on app.payment_refund_requests for each row execute function app.guard_refund_worker_locks()','drop trigger refund_request_guard on app.payment_refund_requests;'+trigger],
  ['weakened amount CHECK',`alter table app.payment_refund_reservations drop constraint ${constraint};alter table app.payment_refund_reservations add constraint ${constraint} check(amount>=0)`,`alter table app.payment_refund_reservations drop constraint ${constraint};alter table app.payment_refund_reservations add constraint ${constraint} ${originalConstraint}`],
  ['removed foreign key',`alter table app.payment_refund_reservations drop constraint ${fk.conname}`,`alter table app.payment_refund_reservations add constraint ${fk.conname} ${fk.sql}`],
  ['disabled internal foreign key trigger','alter table app.payment_refund_reservations disable trigger all','alter table app.payment_refund_reservations enable trigger all'],
  ['removed unique index','drop index app.application_one_order_selection','create unique index application_one_order_selection on app.application_selection_events(work_publication_id) where kind=\'workRequest\''],
  ['changed default',"alter table app.payment_refund_reservations alter column created_at set default '2000-01-01'::timestamptz",'alter table app.payment_refund_reservations alter column created_at set default clock_timestamp()'],
  ['removed NOT NULL','alter table app.payment_refund_requests alter column request_body drop not null','alter table app.payment_refund_requests alter column request_body set not null'],
  ['changed column type','alter table app.payment_refund_requests alter column idempotence_key type varchar(256)','alter table app.payment_refund_requests alter column idempotence_key type text'],
  ['enabled RLS','alter table app.payment_refund_requests enable row level security','alter table app.payment_refund_requests disable row level security'],
  ['added trigger','create trigger refund_schema_probe before insert on app.payment_refund_requests for each row execute function app.guard_refund_worker_locks()','drop trigger refund_schema_probe on app.payment_refund_requests'],
  ['changed function owner','alter function app.claim_placement_refund_job(text) owner to refund_schema_other_owner','alter function app.claim_placement_refund_job(text) owner to postgres'],
  ['inherited external parent','create table public.refund_schema_parent(id uuid);alter table app.users inherit public.refund_schema_parent','alter table app.users no inherit public.refund_schema_parent;drop table public.refund_schema_parent'],
  ['external inheriting child','create table public.refund_schema_child() inherits(app.payment_refund_requests)','drop table public.refund_schema_child'],
  ['added implicit cast','create cast (app.users as text) with inout as implicit','drop cast (app.users as text)'],
  ['added extended statistics','create statistics app.refund_schema_probe on status,target_type from app.payment_orders','drop statistics app.refund_schema_probe'],
 ];
 await admin.query('create role refund_schema_other_owner nologin');
 try{
  for(const [name,change,restore] of changes)await suite.test('unchanged journal cannot hide '+name,async()=>{
   await admin.query(change);
   try{assert.deepEqual(await journal(),originalJournal);await assert.rejects(check(),{message:'Refund worker database preflight failed'});}
   finally{await admin.query(restore);}
   await check();
  });
 }finally{await admin.query('drop role refund_schema_other_owner');}
}
