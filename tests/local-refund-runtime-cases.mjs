import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {randomBytes,randomUUID} from 'node:crypto';
import {chmod,mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
import {promisify} from 'node:util';

// Only the parent fixture's inspected, labelled disposable container reaches this helper.
export async function testLocalRefundRuntime(suite,{admin,config,ownerDb,purchase,load,operator,merchant,provider,artifact,tls}){
 assert.equal(config.host,'127.0.0.1');assert.equal(config.database,'blizhniy_test');
 const owned=await mkdtemp(join(tmpdir(),'blizhniy-refund-runtime-tls-')),ca=join(owned,'server.crt'),key=join(owned,'server.key');
 const {createLocalRefundWorkerRuntime}=await import(pathToFileURL(join(artifact,'scripts/local-refund-worker-runtime.mjs')).href);
 const {runRefundWorkerService}=await import(pathToFileURL(join(artifact,'scripts/refund-worker-service.mjs')).href);
 const run=promisify(execFile);let runtime;
 try{
  await run('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-days','1','-subj','/CN=local-refund-test',
   '-addext','subjectAltName=IP:127.0.0.1','-addext','basicConstraints=critical,CA:TRUE','-keyout',key,'-out',ca],{timeout:10000});
  await chmod(ca,0o644);
  for(const [source,name]of [[ca,'server.crt'],[key,'server.key']]){
   await tls.docker(['cp',source,`${tls.container}:/tmp/refund-${name}`]);
   await tls.docker(['exec','--user','0',tls.container,'cp','/tmp/refund-'+name,'/var/lib/postgresql/refund-'+name]);
  }
  await tls.docker(['exec','--user','0',tls.container,'chown','postgres:postgres','/var/lib/postgresql/refund-server.key']);
  await tls.docker(['exec','--user','0',tls.container,'chmod','600','/var/lib/postgresql/refund-server.key']);
  await admin.query("alter system set ssl_cert_file='/var/lib/postgresql/refund-server.crt'");
  await admin.query("alter system set ssl_key_file='/var/lib/postgresql/refund-server.key'");
  await admin.query("alter system set ssl='on'");await admin.query('select pg_reload_conf()');
  const deadline=Date.now()+5000;
  while((await admin.query("select current_setting('ssl') as ssl")).rows[0].ssl!=='on'){
   assert.ok(Date.now()<deadline);await new Promise(r=>setTimeout(r,20));
  }
  const environment=shop=>({NODE_ENV:'production',BLIZHNIY_REFUND_WORKER:'local-test',BLIZHNIY_PAYMENT_MODE:'test',
   BLIZHNIY_DB_HOST:config.host,BLIZHNIY_DB_PORT:String(config.port),BLIZHNIY_DB_NAME:config.database,
   BLIZHNIY_DB_USER:config.user,BLIZHNIY_DB_PASSWORD:config.password,BLIZHNIY_DB_CA_FILE:ca,BLIZHNIY_DB_SSL_MODE:'verify-full',
   BLIZHNIY_PAYMENT_SHOP_ID:shop.shopId,BLIZHNIY_PAYMENT_SECRET_KEY:shop.secretKey});
  await suite.test('compiled local refund check verifies real TLS/schema/role and TEST merchant without claiming or sending',async()=>{
   let reads=0;
   runtime=await createLocalRefundWorkerRuntime(environment(merchant),{fetcher:async(url,init)=>{
    assert.equal(url,'https://api.yookassa.ru/v3/me');assert.equal(init.method,'GET');reads++;
    const sessions=(await admin.query("select s.ssl from pg_stat_activity a join pg_stat_ssl s using(pid) where a.application_name='blizhniy-local-refund-worker'")).rows;
    assert.ok(sessions.length>0);assert.ok(sessions.every(row=>row.ssl));
    return Response.json({account_id:merchant.shopId,test:true,status:'enabled',fiscalization:{enabled:false}});
   }});
   assert.equal(reads,0);await assert.rejects(runtime.placement.tick());
   const events=[];assert.equal(await runRefundWorkerService({mode:'check',signal:new AbortController().signal,createRuntime:async()=>runtime,report:async e=>events.push(e)}),0);
   assert.equal(reads,1);assert.equal(events.at(-1).status,'checked');
  });
  await suite.test('compiled local admission refuses wrong CA, merchant and extra role privileges before any financial work',async()=>{
   for(const variant of ['ca','merchant','privileges']){
    let reads=0;
    if(variant==='privileges')await admin.query('grant select(email) on app.users to blizhniy_refund_worker');
    runtime=undefined;
    try{
     await assert.rejects(async()=>{
      runtime=await createLocalRefundWorkerRuntime({...environment(merchant),...(variant==='ca'?{BLIZHNIY_DB_CA_FILE:key}:{})},{fetcher:async()=>{
       reads++;return Response.json({account_id:'wrong',test:true,status:'enabled',fiscalization_enabled:false});
      }});await runtime.preflight();
     });
     if(runtime)await assert.rejects(runtime.placement.tick());
     assert.equal(reads,variant==='merchant'?1:0);
    }finally{await runtime?.close();if(variant==='privileges')await admin.query('revoke select(email) on app.users from blizhniy_refund_worker');}
   }
  });
  await suite.test('compiled TLS runtime and service refund each placement once and restarting preserves one effect and notification',async()=>{
   for(const kind of ['listing','vacancy','workRequest']){
    const shop={...merchant,shopId:'runtime-'+randomBytes(6).toString('hex')},item=await purchase({kind,scope:shop});
    const approval=await new (load('postgres-refund-approvals').PostgresRefundApprovalStore)(ownerDb,shop).approve(operator.token,operator.id,{id:randomUUID(),paymentIntentId:item.id,reason:'Локальная проверка запуска возврата через TLS.'});
    const remote=provider(item,approval.id,shop),fetcher=(url,init)=>url==='https://api.yookassa.ru/v3/me'?
     Promise.resolve(Response.json({account_id:shop.shopId,test:true,status:'enabled',fiscalization:{enabled:false}})):remote.fetcher(url,init);
    const controller=new AbortController(),events=[];
    assert.equal(await runRefundWorkerService({mode:'run',signal:controller.signal,createRuntime:()=>createLocalRefundWorkerRuntime(environment(shop),{fetcher}),
     report:async event=>{events.push(event);if(event.status==='tick')controller.abort();}}),0);
    assert.equal(events.find(e=>e.status==='tick').state,'completed');assert.equal(remote.posts(),1);
    runtime=await createLocalRefundWorkerRuntime(environment(shop),{fetcher});await runtime.preflight();
    assert.deepEqual(await runtime.placement.tick(),{state:'idle'});await runtime.close();assert.equal(remote.posts(),1);
    assert.equal((await admin.query('select count(*)::int as n from app.payment_refund_effects where operation_id=$1',[approval.id])).rows[0].n,1);
    assert.equal((await admin.query('select count(*)::int as n from app.notifications where event_key=$1',['placement_refund:'+item.id])).rows[0].n,1);
    assert.equal((await admin.query('select status from app.payment_orders where id=$1',[item.id])).rows[0].status,'refunded');
   }
  });
  await suite.test('compiled TLS service discovers and compensates an unread paid response with one effect and notification',async()=>{
   const shop={...merchant,shopId:'runtime-response-'+randomBytes(6).toString('hex')},work=await purchase({kind:'workRequest',scope:shop});
   const application=(await admin.query("insert into app.applications(applicant_id,work_publication_id,creation_key,target_revision,specialist_revision,snapshot,is_paid,status,created_at,sent_at) values($1,$2,$3,1,1,'{}',true,'sent',clock_timestamp()-interval '7 days',clock_timestamp()-interval '6 days') returning id",[operator.id,work.targetId,randomUUID()])).rows[0].id;
   const id=randomUUID(),item={id,ownerId:operator.id,targetType:'application',targetId:application,targetRevision:'1',tariffId:'job-response',amount:'99.00',durationDays:null,shopId:shop.shopId,isTest:true,providerPaymentId:randomUUID(),capturedAt:new Date(Date.now()-6*86400000-1000).toISOString()};
   item.metadata={localPaymentId:id,targetId:application,targetType:'application',tariffId:'job-response'};
   const requestBody=JSON.stringify({amount:{value:item.amount,currency:'RUB'},capture:true,confirmation:{type:'redirect',return_url:'https://fixture.example.invalid/return'},metadata:item.metadata});
   await ownerDb.transaction(async tx=>{
    const {providerPaymentId,capturedAt,metadata,...binding}=item;assert.ok(providerPaymentId&&capturedAt&&metadata);
    await new (load('postgres-payment-intents').PostgresPaymentIntentStore)(ownerDb).persistInTransaction(tx,{...binding,requestBody});
    await tx.query("insert into app.payment_orders(id,owner_id,creation_key,target_type,target_id,target_revision) values($1,$2,$3,'application',$4,1)",[id,item.ownerId,randomUUID(),application]);
    await tx.query('insert into app.payment_dispatch_anchors(intent_id) values($1)',[id]);await tx.query('insert into app.payment_provider_links(intent_id,provider_payment_id) values($1,$2)',[id,item.providerPaymentId]);
    await tx.query("update app.payment_orders set status='succeeded' where id=$1",[id]);await tx.query("insert into app.payment_verifications(intent_id,provider_payment_id,status,captured_at) values($1,$2,'succeeded',$3)",[id,item.providerPaymentId,item.capturedAt]);
   });
   const remote=provider(item,id,shop),fetcher=(url,init)=>url==='https://api.yookassa.ru/v3/me'?
    Promise.resolve(Response.json({account_id:shop.shopId,test:true,status:'enabled',fiscalization:{enabled:false}})):remote.fetcher(url,init);
   const controller=new AbortController();let ticks=0,completed=false;
   assert.equal(await runRefundWorkerService({mode:'run',signal:controller.signal,createRuntime:()=>createLocalRefundWorkerRuntime(environment(shop),{fetcher}),wait:async()=>{},
    report:async event=>{if(event.status==='tick'){assert.ok(++ticks<=200);if(event.kind==='application'&&event.state==='completed'){completed=true;controller.abort();}}}}),0);
   assert.equal(completed,true);assert.equal(remote.posts(),1);
   runtime=await createLocalRefundWorkerRuntime(environment(shop),{fetcher});await runtime.preflight();assert.deepEqual(await runtime.application.sweep().then(v=>v.processing),{state:'idle'});await runtime.close();
   assert.equal(remote.posts(),1);
   assert.equal((await admin.query('select count(*)::int as n from app.application_compensation_refunds where payment_intent_id=$1',[id])).rows[0].n,1);
   assert.equal((await admin.query('select count(*)::int as n from app.notifications where event_key=$1',['application_compensation:'+id])).rows[0].n,1);
   assert.equal((await admin.query('select status from app.applications where id=$1',[application])).rows[0].status,'sent');
  });
 }finally{try{await runtime?.close();}finally{await rm(owned,{recursive:true,force:true});}}
}
