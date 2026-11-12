import assert from 'node:assert/strict';
import {mkdtemp,chmod,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {rootCertificates} from 'node:tls';
import {testLocalRefundAdmin} from './local-refund-admin-cases.mjs';
import {randomBytes,randomUUID} from 'node:crypto';

// Parent supplies its inspected disposable container and the TLS certificate installed by its worker fixture.
export async function testLocalRefundOperatorRuntime(suite,{admin,config,artifact,tls,purchase,load,operator,merchant,provider,refundDb}){
 assert.equal(config.host,'127.0.0.1');assert.equal(config.database,'blizhniy_test');assert.equal(config.user,'blizhniy_refund_operator');
 const owned=await mkdtemp(join(tmpdir(),'blizhniy-local-operator-tls-')),ca=join(owned,'server.crt');let runtime;
 try{
  // Reuse the public certificate through the parent fixture's owned-container command.
  const certificate=await tls.docker(['exec',tls.container,'cat','/var/lib/postgresql/refund-server.crt']);
  await writeFile(ca,certificate+'\n',{mode:0o644});await chmod(ca,0o644);
  assert.equal((await admin.query("select current_setting('ssl') as ssl")).rows[0].ssl,'on');
  const {createLocalRefundOperatorRuntime}=await import(pathToFileURL(join(artifact,'scripts/local-refund-operator-runtime.mjs')).href);
  const environment=shop=>({NODE_ENV:'production',BLIZHNIY_REFUND_OPERATOR:'local-test',BLIZHNIY_PAYMENT_MODE:'test',BLIZHNIY_DB_HOST:config.host,
   BLIZHNIY_DB_PORT:String(config.port),BLIZHNIY_DB_NAME:config.database,BLIZHNIY_DB_USER:config.user,BLIZHNIY_DB_PASSWORD:config.password,
   BLIZHNIY_DB_SSL_MODE:'verify-full',BLIZHNIY_DB_CA_FILE:ca,BLIZHNIY_PAYMENT_SHOP_ID:shop.shopId,BLIZHNIY_PAYMENT_SECRET_KEY:shop.secretKey});
  const me=shop=>Response.json({account_id:shop.shopId,test:true,status:'enabled',fiscalization:{enabled:false}});
  await suite.test('compiled operator factory is dormant and read-only preflight proves real TLS without creating financial records',async()=>{
   const counts=async()=>(await admin.query('select (select count(*)::int from app.payment_refund_approvals) as approvals,(select count(*)::int from app.payment_refund_recovery_actions) as actions,(select count(*)::int from app.payment_refund_send_attempts) as attempts')).rows[0];
   const before=await counts();let reads=0;
   runtime=await createLocalRefundOperatorRuntime(environment(merchant),{fetcher:async(url,init)=>{
    assert.equal(init.method,'GET');assert.equal(url,'https://api.yookassa.ru/v3/me');reads++;
    const sessions=(await admin.query("select s.ssl from pg_stat_activity a join pg_stat_ssl s using(pid) where a.application_name='blizhniy-local-refund-operator'")).rows;
    assert.ok(sessions.length>0);assert.ok(sessions.every(row=>row.ssl));return me(merchant);
   }});
   assert.equal(reads,0);await runtime.preflight();assert.equal(reads,1);assert.deepEqual(await counts(),before);await runtime.close();
  });
  await suite.test('compiled TLS operator refuses wrong CA, wrong TEST shop and excess privileges before approval',async()=>{
   const item=await purchase(),wrongCa=join(owned,'wrong-ca.crt');await writeFile(wrongCa,rootCertificates[0],{mode:0o644});
   for(const variant of ['ca','merchant','privileges']){
    let reads=0;const input={id:randomUUID(),paymentIntentId:item.id,reason:'Проверка отказа до решения о возврате.'};runtime=undefined;
    if(variant==='privileges')await admin.query('grant select(email) on app.users to blizhniy_refund_operator');
    try{
     await assert.rejects(async()=>{
      runtime=await createLocalRefundOperatorRuntime({...environment(merchant),...(variant==='ca'?{BLIZHNIY_DB_CA_FILE:wrongCa}:{})},{fetcher:async(url,init)=>{
       reads++;assert.equal(init.method,'GET');assert.equal(url,'https://api.yookassa.ru/v3/me');return me({...merchant,shopId:'wrong-shop'});
      }});await runtime.approve(operator.token,operator.id,input);
     },{message:'Local refund operator unavailable'});
     assert.equal(reads,variant==='merchant'?1:0);assert.equal((await admin.query('select count(*)::int as n from app.payment_refund_approvals where id=$1',[input.id])).rows[0].n,0);
    }finally{await runtime?.close();if(variant==='privileges')await admin.query('revoke select(email) on app.users from blizhniy_refund_operator');}
   }
  });
  await suite.test('compiled TLS operator approves, reads and recovers once; terminal same-action proof survives total provider outage',async()=>{
   const shop={...merchant,shopId:'runtime-operator-'+randomBytes(6).toString('hex')},item=await purchase({scope:shop}),id=randomUUID(),remote=provider(item,id,shop);
   let offline=false;const calls=[];
   runtime=await createLocalRefundOperatorRuntime(environment(shop),{fetcher:async(url,init)=>{
    calls.push(String(url));assert.equal(init.method,'GET');if(offline)throw Error('Synthetic total provider outage');
    return url==='https://api.yookassa.ru/v3/me'?me(shop):remote.fetcher(url,init);
   }});
   const approval=await runtime.approve(operator.token,operator.id,{id,paymentIntentId:item.id,reason:'Локальная проверка программного оператора.'});assert.equal(calls.length,1);
   assert.deepEqual(await runtime.readForAdmin(operator.token,operator.id,id),approval);assert.equal(calls.length,1);
   assert.deepEqual(await load('placement-refund-worker').createPlacementRefundWorker(refundDb,shop,async(url,init)=>{
    if(init.method==='GET'&&String(url).includes('/v3/refunds/'))throw Error('Synthetic refund GET outage');return remote.fetcher(url,init);
   }).tick(),{state:'deferred',code:'processing_unavailable'});
   const candidate=(await admin.query('select provider_refund_id as id from app.payment_refund_candidates where operation_id=$1',[id])).rows[0];assert.ok(candidate);
   const action={id:randomUUID(),operationId:id,providerRefundId:candidate.id,reason:'Сверка подтверждённого результата возврата.'};
   assert.equal((await runtime.recover(operator.token,operator.id,action)).state,'applied');assert.equal(remote.posts(),1);
   assert.equal(calls.filter(url=>url.endsWith('/v3/me')).length,2);const before=calls.length;offline=true;
   assert.deepEqual(await runtime.readForAdmin(operator.token,operator.id,id),approval);assert.equal((await runtime.recover(operator.token,operator.id,action)).state,'applied');assert.equal(calls.length,before);
   assert.equal((await admin.query('select count(*)::int as n from app.payment_refund_effects where operation_id=$1',[id])).rows[0].n,1);
   assert.equal((await admin.query('select count(*)::int as n from app.notifications where event_key=$1',['placement_refund:'+item.id])).rows[0].n,1);await runtime.close();
  });
  await suite.test('revocation during merchant admission leaves only the requested audit and starts no refund GET or effect',async()=>{
   const shop={...merchant,shopId:'runtime-operator-revoke-'+randomBytes(6).toString('hex')},item=await purchase({scope:shop}),id=randomUUID(),remote=provider(item,id,shop);
   const actor={id:randomUUID(),token:randomBytes(32).toString('hex')};
   await admin.query("insert into app.users(id,email,password_hash,role,email_verified_at) values($1,$2,$3,'admin',clock_timestamp())",[actor.id,actor.id+'@operator.invalid','scrypt$131072$8$1$'+'a'.repeat(32)+'$'+'b'.repeat(128)]);
   await admin.query("insert into app.sessions(token_hash,user_id,scope,auth_version,expires_at) values($1,$2,'app',0,clock_timestamp()+interval '1 hour')",[load('identity').hashSessionToken(actor.token),actor.id]);
   let revoke=false,refundReads=0;
   runtime=await createLocalRefundOperatorRuntime(environment(shop),{fetcher:async(url,init)=>{
    assert.equal(init.method,'GET');if(url==='https://api.yookassa.ru/v3/me'){
     if(revoke)await admin.query("update app.users set role='user' where id=$1",[actor.id]);return me(shop);
    }refundReads++;return remote.fetcher(url,init);
   }});
   await runtime.approve(actor.token,actor.id,{id,paymentIntentId:item.id,reason:'Проверка отзыва полномочий во время допуска.'});
   await load('placement-refund-worker').createPlacementRefundWorker(refundDb,shop,async(url,init)=>{
    if(init.method==='GET'&&String(url).includes('/v3/refunds/'))throw Error('Synthetic refund GET outage');return remote.fetcher(url,init);
   }).tick();
   const candidate=(await admin.query('select provider_refund_id as id from app.payment_refund_candidates where operation_id=$1',[id])).rows[0];assert.ok(candidate);
   const action={id:randomUUID(),operationId:id,providerRefundId:candidate.id,reason:'Проверка повторной авторизации после допуска.'};revoke=true;
   await assert.rejects(runtime.recover(actor.token,actor.id,action),{message:'Local refund operator unavailable'});assert.equal(refundReads,0);assert.equal(remote.posts(),1);
   assert.deepEqual((await admin.query('select phase from app.payment_refund_recovery_actions where action_id=$1',[action.id])).rows,[{phase:'requested'}]);
   assert.equal((await admin.query('select count(*)::int as n from app.payment_refund_effects where operation_id=$1',[id])).rows[0].n,0);await runtime.close();
  });
  await testLocalRefundAdmin(suite,{admin,artifact,environment,createLocalRefundOperatorRuntime,purchase,load,operator,merchant,provider,refundDb});
 }finally{try{await runtime?.close();}finally{await rm(owned,{recursive:true,force:true});}}
}
