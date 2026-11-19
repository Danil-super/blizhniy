import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';

export async function checkSpecialistServiceStartup({suite,admin,config,workerDb,copiedGuard,artifact,docker,container,connect}){
 const filename='0065-specialist-account-test.sql';
 const sql=await readFile(new URL('../database/candidates/'+filename,import.meta.url),'utf8');
 const digest=createHash('sha256').update(sql).digest('hex');
 const role='blizhniy_payment_reconciler';
 const validate=(specialistAccountTest,db=workerDb,database=config.database)=>copiedGuard.verifyPaymentReconciliationDatabase(db,{database,publicationTest:true,specialistAccountTest});
 await suite.test('the old database remains readable but cannot admit specialist processing',async()=>{
  await validate(false);await assert.rejects(validate(true));
 });
 await admin.query(sql);
 await admin.query('insert into blizhniy_meta.migrations values($1,$2)',[filename,digest]);
 await suite.test('specialist processing requires the exact new column privilege',async()=>{
  await assert.rejects(validate(true));
  await admin.query('grant select(intent_id) on app.specialist_checkout_terms to '+role);
  await validate(true);await validate(false);
 });
 await suite.test('operator, public and unrelated roles cannot acquire extra access to specialist processing',async()=>{
  await admin.query('create role enrollment_observer_fixture nologin');
  for(const [privilege,object,recipient] of [
   ['select(created_at)','app.specialist_checkout_terms',role],
   ['select(intent_id)','app.specialist_checkout_terms','public'],
   ['select(intent_id)','app.specialist_checkout_terms','enrollment_observer_fixture'],
   ['select(owner_id)','app.specialist_test_enrollment',role],
   ['select(shop_id)','app.specialist_test_enrollment','enrollment_observer_fixture'],
   ['select','app.specialist_test_enrollment','public'],
   ['execute','function app.require_specialist_test_terms()','enrollment_observer_fixture'],
  ]){
   await admin.query('grant '+privilege+' on '+object+' to '+recipient);
   try{await assert.rejects(validate(true));await assert.rejects(validate(false));}
   finally{await admin.query('revoke '+privilege+' on '+object+' from '+recipient);}
   await validate(true);
  }
 });
 await suite.test('specialist startup verifies both the recorded migration and the installed enforcement',async()=>{
  await admin.query("update blizhniy_meta.migrations set sha256=repeat('0',64) where name=$1",[filename]);
  try{await assert.rejects(validate(true));}finally{await admin.query('update blizhniy_meta.migrations set sha256=$2 where name=$1',[filename,digest]);}
  await admin.query('alter table app.payment_dispatch_anchors disable trigger specialist_test_dispatch_guard');
  try{await assert.rejects(validate(true));}finally{await admin.query('alter table app.payment_dispatch_anchors enable trigger specialist_test_dispatch_guard');}
  const path=join(artifact,'database/candidates',filename),bytes=await readFile(path);
  assert.deepEqual(bytes,Buffer.from(sql));
  await writeFile(path,Buffer.concat([bytes,Buffer.from('\n-- fixture\n')]));
  try{await assert.rejects(validate(true));}finally{await writeFile(path,bytes);}
  await validate(true);
 });
 await suite.test('restored specialist schema admits the same service modes with the existing financial role',async()=>{
  const database='specialist_service_restored';
  await admin.query('create database specialist_service_restored template template0');
  await admin.query('revoke all on database specialist_service_restored from public;grant connect on database specialist_service_restored to '+role);
  await docker(['exec',container,'bash','-euo','pipefail','-c',
   'pg_dump --format=custom --username=postgres --no-password --dbname="$1" | pg_restore --single-transaction --exit-on-error --username=postgres --no-password --dbname="$2"',
   'restore-fixture',config.database,database]);
  const copy=connect(database);
  try{await validate(true,copy,database);await validate(false,copy,database);}finally{await copy.close();}
 });
}
