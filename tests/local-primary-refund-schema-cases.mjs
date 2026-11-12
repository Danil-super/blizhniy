import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import pg from 'pg';
import {readRefundSchema,assertRefundSchema} from '../scripts/refund-worker-schema.mjs';

/** The parent owns a new synthetic container; no persistent stand or data is read. */
export async function testLocalPrimaryRefundSchema(suite,{admin,plan}){
 const fingerprint=async client=>{
  await client.query('begin read only');
  try{return await readRefundSchema(client);}finally{await client.query('rollback');}
 };
 await suite.test('local profile reproduces the manual migration order under another owner without accepting the source-only profile',async()=>{
  const expected=JSON.parse(await readFile(new URL('../database/refund-schema-local-primary-0055.json',import.meta.url),'utf8'));
  const client=await admin.connect();
  try{
   assert.deepEqual(await fingerprint(client),expected);
   await client.query('begin read only');
   try{
    await assert.rejects(assertRefundSchema(client,55),{message:'Invalid refund schema'});
    await assertRefundSchema(client,55,{localPrimary:true});
    await assert.rejects(assertRefundSchema(client,54,{localPrimary:true}),{message:'Invalid refund schema version'});
   }finally{await client.query('rollback');}
  }finally{client.release();}
  await admin.query('create role local_refund_reference_owner nologin');
  await admin.query('create database local_refund_reference owner local_refund_reference_owner');
  const reference=new pg.Client({...admin.options,password:admin.options.password,database:'local_refund_reference'});
  try{
   await reference.connect();await reference.query('set role local_refund_reference_owner');
   const sparse=plan.journal.filter(({name})=>Number(name.slice(0,4))<=35||/^(0041|0044|0046|0047)-/.test(name));
   assert.equal(sparse.length,39);
   for(const {name} of sparse)await reference.query(await readFile(new URL('../database/migrations/'+name,import.meta.url),'utf8'));
   await reference.query(await readFile(new URL('../database/local-primary-payment.sql',import.meta.url),'utf8'));
   await reference.query(await readFile(new URL('../database/permissions/telegram-phone.sql',import.meta.url),'utf8'));
   await reference.query('begin read only');
   try{await assert.rejects(assertRefundSchema(reference,55,{localPrimary:true}),{message:'Invalid refund schema'});}
   finally{await reference.query('rollback');}
   const present=new Set(sparse.map(entry=>entry.name));
   const additions=plan.journal.filter(entry=>!present.has(entry.name));assert.equal(additions.length,16);
   for(const {name} of additions)await reference.query(await readFile(new URL('../database/migrations/'+name,import.meta.url),'utf8'));
   assert.deepEqual(await fingerprint(reference),expected);
  }finally{await reference.end();await admin.query('drop database local_refund_reference');await admin.query('drop role local_refund_reference_owner');}
 });
 const changes=[
  ['policy USING',"alter policy phone_attempt_server on app.telegram_phone_attempts using(true)"],
  ['policy WITH CHECK',"alter policy phone_binding_server on app.telegram_phone_bindings with check(true)"],
  ['policy role',"alter policy phone_attempt_server on app.telegram_phone_attempts to public"],
  ['policy command',"drop policy phone_attempt_server on app.telegram_phone_attempts;create policy phone_attempt_server on app.telegram_phone_attempts for select to blizhniy_runtime using(user_id=nullif(current_setting('app.phone_user_id',true),'')::uuid)"],
  ['policy permissiveness',"drop policy phone_attempt_server on app.telegram_phone_attempts;create policy phone_attempt_server on app.telegram_phone_attempts as restrictive to blizhniy_runtime using(user_id=nullif(current_setting('app.phone_user_id',true),'')::uuid) with check(user_id=nullif(current_setting('app.phone_user_id',true),'')::uuid)"],
  ['extra policy',"create policy local_refund_probe on app.telegram_phone_attempts using(true)"],
  ['missing policy',"drop policy phone_attempt_server on app.telegram_phone_attempts"],
  ['external FK action',"alter table local_primary.provider_payments drop constraint provider_payments_intent_id_fkey;alter table local_primary.provider_payments add constraint provider_payments_intent_id_fkey foreign key(intent_id) references app.payment_checkout_intents(id) on delete restrict"],
  ['external FK source',"alter table local_primary.application_deliveries drop constraint application_deliveries_application_id_fkey;alter table local_primary.application_deliveries add constraint application_deliveries_application_id_fkey foreign key(intent_id) references app.applications(id) on delete restrict"],
  ['external FK trigger',"alter table app.payment_checkout_intents disable trigger all"],
 ];
 for(const [name,change] of changes)await suite.test('local profile refuses changed '+name,async()=>{
  const client=await admin.connect();
  try{
   await client.query('begin');await client.query(change);
   await assert.rejects(assertRefundSchema(client,55,{localPrimary:true}),{message:'Invalid refund schema'});
  }finally{await client.query('rollback');client.release();}
 });
}
