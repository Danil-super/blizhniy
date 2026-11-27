import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {provider} from './refund-worker-role-cases.mjs';

export async function testHostedUndeliveredCompensation({admin,config,workerDb,compiledWorker,load,refundWorker,artifact,directory}){
 const merchant={shopId:'9201',isTest:true,secretKey:'test_synthetic_only'};
 const applicant=randomUUID(),recipient=randomUUID();
 for(const user of [applicant,recipient])await admin.query('insert into app.users(id,email,password_hash,email_verified_at) values($1,$2,$3,now())',
  [user,user+'@response.invalid','scrypt$131072$8$1$'+'a'.repeat(32)+'$'+'b'.repeat(128)]);
 async function seed({confirmed=true,admitted=true,live=false,blocked=null,viewed=false}={}){
  const work=randomUUID(),targetId=randomUUID(),id=randomUUID(),providerPaymentId=randomUUID();
  const createdAt=new Date(Date.now()-120000).toISOString(),capturedAt=new Date(Date.now()-60000).toISOString();
  const tariffId='job-response',amount='99.00',metadata={localPaymentId:id,targetId,targetType:'application',tariffId};
  await admin.query("insert into app.work_publications(id,author_id,kind,creation_key,form) values($1,$2,'workRequest',$3,$4)",
   [work,recipient,randomUUID(),{kind:'workRequest',title:'Синтетический заказ'}]);
  await admin.query(`insert into app.applications(id,applicant_id,work_publication_id,creation_key,target_revision,specialist_revision,snapshot,status,is_paid,sent_at,created_at)
   values($1,$2,$3,$4,1,1,'{}',$5,$6,$7,$8)`,[targetId,applicant,work,randomUUID(),viewed?'viewed':'pending_payment',viewed,viewed?capturedAt:null,createdAt]);
  const body={amount:{value:amount,currency:'RUB'},capture:true,confirmation:{type:'redirect',return_url:'https://response.invalid/return'},metadata};
  await admin.query(`insert into app.payment_checkout_intents(id,owner_id,target_type,target_id,target_revision,tariff_id,amount,merchant_shop_id,is_test,request_body,created_at)
   values($1,$2,'application',$3,1,$4,$5,$6,$7,$8,$9)`,[id,applicant,targetId,tariffId,amount,merchant.shopId,!live,JSON.stringify(body),createdAt]);
  await admin.query("insert into app.payment_orders(id,owner_id,creation_key,target_type,target_id,target_revision,created_at) values($1,$2,$3,'application',$4,1,$5)",
   [id,applicant,randomUUID(),targetId,createdAt]);
  if(admitted)await admin.query('insert into app_response.admissions(intent_id,applicant_id,shop_id) values($1,$2,$3)',[id,applicant,merchant.shopId]);
  await admin.query('insert into app.payment_dispatch_anchors(intent_id) values($1)',[id]);
  await admin.query('insert into app.payment_provider_links(intent_id,provider_payment_id) values($1,$2)',[id,providerPaymentId]);
  if(confirmed){
   await admin.query("update app.payment_orders set status='succeeded' where id=$1",[id]);
   await admin.query("insert into app.payment_verifications(intent_id,provider_payment_id,status,captured_at) values($1,$2,'succeeded',$3)",[id,providerPaymentId,capturedAt]);
  }
  await admin.query('insert into app.payment_reconciliation_jobs(intent_id) values($1) on conflict do nothing',[id]);
  if(blocked)await admin.query("update app.payment_reconciliation_jobs set state='blocked',attempts=$2,last_code=$3 where intent_id=$1",
   [id,blocked==='attempts_exhausted'?12:1,blocked]);
  if(viewed){
   await admin.query('insert into app_response.deliveries(intent_id,application_id,sent_at) values($1,$2,$3)',[id,targetId,capturedAt]);
   await admin.query("insert into app.application_contact_views(application_id,recipient_id,evidence) values($1,$2,'recipient_read')",[targetId,recipient]);
  }
  return{id,targetId,providerPaymentId,capturedAt,metadata,amount};
 }
 const payment=await seed({confirmed:false}),remote=provider(payment,payment.id,merchant);
 const reconciler=compiledWorker(workerDb,merchant,remote.fetcher,applicant,undefined,true);
 assert.deepEqual(await reconciler.tick(),{state:'blocked',code:'publication_blocked'});
 assert.equal(remote.posts(),0);
 const waiting=await seed(),exhausted=await seed({blocked:'attempts_exhausted'}),withoutAdmission=await seed({admitted:false,blocked:'publication_blocked'});
 const live=await seed({live:true,blocked:'publication_blocked'}),viewed=await seed({viewed:true});
 const disclosures=async()=>(await admin.query('select * from app.application_contact_views where application_id=$1',[viewed.targetId])).rows;
 const originalDisclosures=await disclosures();
 assert.equal(originalDisclosures.length,1);
 const {PostgresApplicationCompensationStore}=load('postgres-application-compensation');
 const store=new PostgresApplicationCompensationStore(refundWorker.db,merchant);
 const wrongShop=new PostgresApplicationCompensationStore(refundWorker.db,{...merchant,shopId:'9202'});
 await assert.rejects(wrongShop.claim(payment.id),{name:'ApplicationCompensationAccessError'});
 const locked=await admin.connect();
 try{
  await locked.query('begin');
  await locked.query('select id from app.applications where id=$1 for update',[payment.targetId]);
  await assert.rejects(store.claim(payment.id),{name:'ApplicationCompensationBusyError'});
 }finally{await locked.query('rollback');locked.release();}
 assert.equal(await store.read(payment.id),null);
 const {createLocalRefundWorkerRuntime}=await import(pathToFileURL(join(artifact,'scripts/local-refund-worker-runtime.mjs')).href);
 const env={NODE_ENV:'production',BLIZHNIY_PAYMENT_MODE:'test',BLIZHNIY_REFUND_WORKER:'hosted-schema-local-test',
  BLIZHNIY_DB_HOST:config.host,BLIZHNIY_DB_PORT:String(config.port),BLIZHNIY_DB_NAME:config.database,
  BLIZHNIY_DB_USER:refundWorker.role,BLIZHNIY_DB_PASSWORD:refundWorker.password,BLIZHNIY_DB_CA_FILE:join(directory,'refund-ca.crt'),
  BLIZHNIY_DB_SSL_MODE:'verify-full',BLIZHNIY_PAYMENT_SHOP_ID:merchant.shopId,BLIZHNIY_PAYMENT_SECRET_KEY:merchant.secretKey};
 const fetcher=(url,init)=>url==='https://api.yookassa.ru/v3/me'?
  Promise.resolve(Response.json({account_id:merchant.shopId,test:true,status:'enabled',fiscalization:{enabled:false}})):remote.fetcher(url,init);
 const runtime=await createLocalRefundWorkerRuntime(env,{fetcher});
 try{
  await runtime.preflight();
  const outcome=await runtime.application.sweep();
  assert.deepEqual(outcome.processing,{state:'completed'});
  assert.equal(outcome.discovery.claimed,1);
  assert.equal(remote.posts(),1);
  assert.deepEqual((await runtime.application.sweep()).processing,{state:'idle'});
  assert.equal(remote.posts(),1);
 }finally{await runtime.close();}
 const result=await store.read(payment.id);
 assert.equal(result.policyVersion,'paid-response-undelivered-v1');
 assert.equal(result.reason,'delivery-blocked');assert.equal(result.amount,payment.amount);
 assert.equal(result.deliveredAt,null);assert.equal(result.contactViewAt,null);
 const expected=(await admin.query('select o.status,a.is_paid,a.sent_at from app.payment_orders o join app.applications a on a.id=o.target_id where o.id=$1',[payment.id])).rows[0];
 assert.deepEqual(expected,{status:'refunded',is_paid:false,sent_at:null});
 assert.equal((await admin.query('select count(*)::int n from app_response.deliveries where intent_id=$1',[payment.id])).rows[0].n,0);
 assert.equal((await admin.query('select count(*)::int n from app.application_compensation_refunds where payment_intent_id=$1',[payment.id])).rows[0].n,1);
 const notices=await admin.query('select body from app.notifications where user_id=$1 and event_key=$2',[applicant,'application_compensation:'+payment.id]);
 assert.deepEqual(notices.rows,[{body:'Плата за недоставленный отклик возвращена.'}]);
 const unsupported=[waiting.id,exhausted.id,withoutAdmission.id,live.id,viewed.id];
 assert.equal((await admin.query("select count(*)::int n from app.payment_orders where id=any($1) and status='succeeded'",[unsupported])).rows[0].n,unsupported.length);
 assert.equal((await admin.query('select count(*)::int n from app.application_compensation_cases where payment_intent_id=any($1)',[unsupported])).rows[0].n,0);
 assert.deepEqual(await disclosures(),originalDisclosures);
 await assert.rejects(admin.query("insert into app.payment_orders(id,owner_id,creation_key,target_type,target_id,target_revision) values($1,$2,$3,'application',$4,1)",
  [randomUUID(),applicant,randomUUID(),payment.targetId]),{code:'23514',message:'Response checkout already compensated'});
}
