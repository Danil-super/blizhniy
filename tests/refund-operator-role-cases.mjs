import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {mkdtempSync,rmSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {randomBytes,randomUUID} from 'node:crypto';
import pg from 'pg';
import {getRefundOperatorRolePlan,verifyRefundOperatorDatabase} from '../scripts/refund-operator-role.mjs';
import {verifyRefundWorkerDatabase} from '../scripts/refund-worker-role.mjs';
import {verifyPaymentReconciliationDatabase} from '../scripts/payment-reconciliation-role.mjs';
import {testRefundOperatorAdmission} from './refund-operator-admission-cases.mjs';
import {buildRefundOperator} from '../scripts/build-refund-operator.mjs';
import {testRefundOperatorActions} from './refund-operator-actions-cases.mjs';

// Owned disposable fixture only. The operator is trusted financial code, not an untrusted SQL principal.
export async function testRefundOperatorRole(suite,{admin,ownerDb,refundDb,purchase,load,operator,merchant,provider}){
 const plan=getRefundOperatorRolePlan('blizhniy_test'),password=randomBytes(24).toString('hex');
 const owned=mkdtempSync(join(tmpdir(),'blizhniy-operator-role-')),artifact=join(owned,'artifact'),originalFetch=globalThis.fetch;let unexpectedHttp=0;
 globalThis.fetch=()=>{unexpectedHttp++;throw Error('Unexpected provider request');};
 const {PostgresDatabase}=load('postgres');let db;
 try{
  buildRefundOperator(artifact);symlinkSync(fileURLToPath(new URL('../node_modules',import.meta.url)),join(artifact,'node_modules'),'dir');
  const require=createRequire(import.meta.url),operatorLoad=name=>require(join(artifact,'compiled/lib/'+name+'.js'));
  const artifactGuard=(await import(pathToFileURL(join(artifact,'scripts/refund-operator-role.mjs')).href)).verifyRefundOperatorDatabase;
  await admin.query(await readFile(new URL('../database/migrations/0055-refund-operator-locks.sql',import.meta.url),'utf8'));
  const migration=plan.journal.at(-1);await admin.query('insert into blizhniy_meta.migrations(name,sha256) values($1,$2)',[migration.name,migration.sha256]);
  await admin.query(plan.createRole);await admin.query(`alter role ${plan.role} login password ${pg.escapeLiteral(password)}`);
  db=new PostgresDatabase(new pg.Pool({...admin.options,user:plan.role,password,max:3}));
  const check=async()=>{await verifyRefundOperatorDatabase(db,{database:'blizhniy_test',merchant});await artifactGuard(db,{database:'blizhniy_test',merchant});};
  await suite.test('operator admission requires its own exact55 schema and grants while the refund worker retains its existing authority',async()=>{
   await assert.rejects(check(),{message:'Refund operator database preflight failed'});
   for(const sql of plan.grants)await admin.query(sql);
   await check();await verifyRefundWorkerDatabase(refundDb,{database:'blizhniy_test',merchant});
   await assert.rejects(verifyRefundOperatorDatabase(ownerDb,{database:'blizhniy_test',merchant}));
   await assert.rejects(verifyPaymentReconciliationDatabase(db,{database:'blizhniy_test'}));
  });
  await testRefundOperatorAdmission(suite,{admin,db,refundDb,load,merchant,check});
  await suite.test('operator row locks work but UPDATE id including no-op, SET ROLE and SECURITY DEFINER cannot change identity',async()=>{
   const item=await purchase();
   for(const [table,id]of [['users',operator.id],['payment_checkout_intents',item.id],['payment_orders',item.id]]){
    await db.transaction(async tx=>{assert.equal((await tx.query(`select id from app.${table} where id=$1 for update`,[id])).rowCount,1);});
    for(const replacement of [id,randomUUID()])await assert.rejects(db.query(`update app.${table} set id=$2 where id=$1`,[id,replacement]),{code:'23514'});
    await assert.rejects(ownerDb.transaction(async tx=>{await tx.query('set local role blizhniy_refund_operator');await tx.query(`update app.${table} set id=id where id=$1`,[id]);}),{code:'23514'});
   }
   await admin.query("create function app.operator_id_probe(value uuid) returns void language sql security definer set search_path='' as $$update app.users set id=id where id=value$$;revoke all on function app.operator_id_probe(uuid) from public;grant execute on function app.operator_id_probe(uuid) to blizhniy_refund_operator");
   try{await assert.rejects(db.query('select app.operator_id_probe($1)',[operator.id]),{code:'23514'});}
   finally{await admin.query('drop function app.operator_id_probe(uuid)');}await check();
   await admin.query('alter table app.users disable trigger refund_operator_lock_only');
   try{
    await assert.rejects(check(),{message:'Refund operator database preflight failed'});
    assert.equal((await db.query('update app.users set id=id where id=$1 returning id',[operator.id])).rowCount,1);
   }finally{await admin.query('alter table app.users enable always trigger refund_operator_lock_only');}
   await check();
  });
  await suite.test('operator cannot read passwords/profiles, send, reset queues, change payments/publications or erase history',async()=>{
   for(const sql of ['select password_hash from app.users','select * from app.cabinet_profiles','select * from app.placement_refund_jobs',
    'insert into app.payment_refund_reservations default values','insert into app.payment_refund_requests default values',
    'insert into app.payment_refund_dispatch_anchors default values','insert into app.payment_refund_send_attempts default values',
    'insert into app.payment_refund_candidates default values',"select app.claim_placement_refund_job('synthetic')",
    "update app.payment_orders set status='refunded' where false","update app.listings set status='published' where false",
    'delete from app.payment_refund_approvals where false',"set session_replication_role='replica'"])
    await assert.rejects(db.query(sql),{code:'42501'});
   await check();
  });
  await suite.test('exact operator approves and reads full placements and GET-recovers each blocked worker result once',async()=>{
   for(const kind of ['listing','vacancy','workRequest']){
    const shop={...merchant,shopId:'operator-'+randomBytes(6).toString('hex')},item=await purchase({kind,scope:shop});
    const store=new (operatorLoad('postgres-refund-approvals').PostgresRefundApprovalStore)(db,shop),input={id:randomUUID(),paymentIntentId:item.id,reason:'Возврат для проверки отдельной роли оператора.'};
    const approval=await store.approve(operator.token,operator.id,input);assert.deepEqual(await store.readForAdmin(operator.token,operator.id,input.id),approval);
    const remote=provider(item,approval.id,shop),worker=load('placement-refund-worker').createPlacementRefundWorker(refundDb,shop,async(url,init)=>{
     if(init.method==='GET'&&String(url).includes('/v3/refunds/'))throw Error('Synthetic refund GET outage');return remote.fetcher(url,init);
    });
    assert.deepEqual(await worker.tick(),{state:'deferred',code:'processing_unavailable'});assert.equal(remote.posts(),1);
    const candidate=(await admin.query('select provider_refund_id as id from app.payment_refund_candidates where operation_id=$1',[approval.id])).rows[0];assert.ok(candidate);
    const recovery=operatorLoad('primary-refund-recovery').createPrimaryRefundRecovery(db,shop,async(url,init)=>{assert.equal(init.method,'GET');return remote.fetcher(url,init);});
    const action={id:randomUUID(),operationId:approval.id,providerRefundId:candidate.id,reason:'Сверка результата после недоступного ответа.'};
    assert.equal((await recovery.recover(operator.token,operator.id,action)).state,'applied');
    assert.equal((await recovery.recover(operator.token,operator.id,action)).state,'applied');assert.equal(remote.posts(),1);
    assert.equal((await admin.query('select count(*)::int as n from app.payment_refund_effects where operation_id=$1',[approval.id])).rows[0].n,1);
    assert.equal((await admin.query('select count(*)::int as n from app.notifications where event_key=$1',['placement_refund:'+item.id])).rows[0].n,1);
    assert.deepEqual((await admin.query('select phase from app.payment_refund_recovery_actions where action_id=$1 order by phase',[action.id])).rows,[{phase:'requested'},{phase:'succeeded'}]);await check();
   }
  });
  await testRefundOperatorActions(suite,{admin,ownerDb,db,refundDb,purchase,load,operatorLoad,operator,merchant,provider,check});
  assert.equal(unexpectedHttp,0);
 }finally{globalThis.fetch=originalFetch;try{await db?.close();}finally{rmSync(owned,{recursive:true,force:true});}}
}
