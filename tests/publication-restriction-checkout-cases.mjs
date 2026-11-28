import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {setTimeout as pause} from 'node:timers/promises';

const targetTable=kind=>kind==='vacancy'||kind==='workRequest'?'app.work_publications':'app.service_publications';

export async function restrictPlacementFixture(admin,kind,id){
 const table=targetTable(kind);
 const result=await admin.query(`insert into app_publication_restriction.restrictions(kind,publication_id,restricted_revision,case_id)
  select kind,id,revision,$3 from ${table} where id=$1 and kind=$2`,[id,kind,randomUUID()]);
 assert.equal(result.rowCount,1);
}

async function restrictWhileDispatchWaits(admin,kind,id,send,unavailable){
 const writer=await admin.connect();
 const table=targetTable(kind);
 let committed=false,rejection;
 try{
  await writer.query('begin');
  const {pid}=(await writer.query('select pg_backend_pid() as pid')).rows[0];
  assert.equal((await writer.query(`select id from ${table} where id=$1 for update`,[id])).rowCount,1);
  await restrictPlacementFixture(writer,kind,id);
  rejection=assert.rejects(send(),{name:unavailable});
  void rejection.catch(()=>{});
  const deadline=Date.now()+4000;
  for(;;){
   const {waiting}=(await admin.query(`select exists(select 1 from pg_stat_activity
    where usename='blizhniy_runtime' and wait_event_type='Lock' and $1=any(pg_blocking_pids(pid))) as waiting`,[pid])).rows[0];
   if(waiting)break;
   assert.ok(Date.now()<deadline,'The payment must wait for the moderator transaction before deciding');
   await pause(15);
  }
  await writer.query('commit');
  committed=true;
  await rejection;
 }finally{
  try{if(!committed)await writer.query('rollback');}
  finally{writer.release();await rejection?.catch(()=>{});}
 }
}

export async function verifyRestrictedPlacementCheckout({
 admin,db,load,merchant,store,kind,owner,token,input,unavailable,alreadyAuthorized=false,concurrent=false,
}){
 const id=input.listingId??input.publicationId;
 const order=await store.prepare(token,owner,input);
 const binding=await store.authorizeDispatch(token,owner,order.id);
 if(alreadyAuthorized){
  const intents=new(load('postgres-payment-intents').PostgresPaymentIntentStore)(db);
  assert.equal((await intents.authorize(binding)).decision,'post');
 }
 const anchors=async()=>(await admin.query('select intent_id,authorized_at from app.payment_dispatch_anchors where intent_id=$1',[order.id])).rows;
 const before=await anchors();
 assert.equal(before.length,alreadyAuthorized?1:0);
 let providerRequests=0;
 const dispatcher=load('primary-payment-dispatch').createPrimaryPaymentDispatcher(db,merchant,async()=>{
  providerRequests++;
  assert.fail('A restricted publication reached the provider simulator');
 });
 const send=()=>dispatcher.dispatch(binding,attempt=>store.authorizeDispatch(token,owner,order.id,true,attempt));
 if(concurrent)await restrictWhileDispatchWaits(admin,kind,id,send,unavailable);
 else{
  await restrictPlacementFixture(admin,kind,id);
  await assert.rejects(send(),{name:unavailable});
 }
 assert.equal(providerRequests,0);
 await assert.rejects(store.preview(token,owner,id,input.expectedRevision),{name:unavailable});
 await assert.rejects(store.prepare(token,owner,{...input,creationKey:randomUUID()}),{name:unavailable});
 assert.deepEqual(await anchors(),before);
 assert.equal((await admin.query('select provider_payment_id from app.payment_provider_links where intent_id=$1',[order.id])).rowCount,0);
 assert.deepEqual(await store.prepare(token,owner,input),order);
 assert.deepEqual(await store.readIntent(token,owner,input.creationKey),order);
 assert.equal((await store.readOrder(token,owner,order.id)).order.status,'created');
}
