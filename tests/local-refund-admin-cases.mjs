import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {join} from 'node:path';

/** Parent owns schema55/TLS, restricted roles and fake provider. No stand installation or real provider I/O. */
export async function testLocalRefundAdmin(suite,{admin,artifact,environment,createLocalRefundOperatorRuntime,purchase,load,operator,merchant,provider,refundDb}){
 const {startLocalRefundOperatorServer}=await import(pathToFileURL(join(artifact,'scripts/local-refund-operator-server.mjs')).href);
 const {callLocalRefundOperator}=load('local-refund-operator-client'),{createAdminRefundHandler}=load('admin-refund-http');
 const origin='https://refund-admin.example.invalid',events=[];
 const request=(command,token=operator.token)=>new Request(origin+'/api/admin/refunds',{method:'POST',headers:{host:new URL(origin).host,origin,'content-type':'application/json','x-blizhniy-request':'1','x-real-ip':'127.0.0.1',cookie:'__Host-blizhniy_session='+token},body:JSON.stringify(command)});
 const handler=service=>createAdminRefundHandler({origin},()=>({limiter:{allowProduction:async()=>true},command:(token,command,signal)=>callLocalRefundOperator(service.socketPath,token,command,signal)}),event=>events.push(event));
 await suite.test('real operator journal pages the merchant chronologically with exact cursor precision and no financial source exposure',async()=>{
  const shop={...merchant,shopId:'admin-journal-'+randomBytes(6).toString('hex')},items=[];for(let i=0;i<51;i++)items.push(await purchase({scope:shop,kind:['listing','vacancy','workRequest'][i%3]}));
  let http=0;const runtime=await createLocalRefundOperatorRuntime(environment(shop),{fetcher:async()=>{http++;throw Error('Read-only journal must not call provider');}}),service=await startLocalRefundOperatorServer(runtime);
  try{
   const invoke=handler(service),command={action:'list',expectedAdminId:operator.id,input:null},firstResponse=await invoke(request(command));assert.equal(firstResponse.status,200);const first=await firstResponse.json();
   assert.equal(first.items.length,50);assert.equal(first.nextAfter,first.items.at(-1).id);assert.equal(first.items.every(row=>row.approvalId===null&&row.operationId===null&&!row.attempted),true);
   const expected=(await admin.query('select id from app.payment_checkout_intents where merchant_shop_id=$1 order by created_at desc,id desc',[shop.shopId])).rows.map(row=>row.id);
   assert.deepEqual(first.items.map(row=>row.id),expected.slice(0,50));
   await purchase({scope:shop});const secondResponse=await invoke(request({...command,input:first.nextAfter}));assert.equal(secondResponse.status,200);const second=await secondResponse.json();assert.deepEqual(second.items.map(row=>row.id),expected.slice(50));assert.equal(second.nextAfter,null);
   const foreign=await purchase();assert.equal((await invoke(request({...command,input:foreign.id}))).status,503);
   assert.equal((await invoke(request(command,randomBytes(32).toString('hex')))).status,503);assert.equal(http,0);
   const serialized=JSON.stringify(first);for(const value of ['requestBody','request_body','ownerId','token_hash','password','email',operator.token])assert.equal(serialized.includes(value),false);
  }finally{await service.close();}
 });
 await suite.test('public boundary to real TLS operator preserves an uncertain approval ID, authorizes recovery and applies one effect/notice',async()=>{
  const shop={...merchant,shopId:'admin-refund-'+randomBytes(6).toString('hex')},item=await purchase({scope:shop}),id=randomUUID(),remote=provider(item,id,shop);let offline=false;
  const runtime=await createLocalRefundOperatorRuntime(environment(shop),{fetcher:async(url,init)=>{
   assert.equal(init.method,'GET');if(offline)throw Error('Synthetic provider outage');return url==='https://api.yookassa.ru/v3/me'?Response.json({account_id:shop.shopId,test:true,status:'enabled',fiscalization:{enabled:false}}):remote.fetcher(url,init);
  }}),service=await startLocalRefundOperatorServer(runtime);
  try{
   let loseReply=true;const normal=handler(service),uncertain=createAdminRefundHandler({origin},()=>({limiter:{allowProduction:async()=>true},command:async(token,command,signal)=>{
    const result=await callLocalRefundOperator(service.socketPath,token,command,signal);if(loseReply){loseReply=false;throw Error('Synthetic lost response after commit');}return result;
   }}),event=>events.push(event));
   const approval={action:'approve',expectedAdminId:operator.id,input:{id,paymentIntentId:item.id,reason:'Возврат через локальную админку.'}};
   assert.equal((await uncertain(request(approval))).status,503);assert.equal(remote.posts(),0);
   const read=await normal(request({action:'read',expectedAdminId:operator.id,input:id}));assert.equal(read.status,200);assert.equal((await read.json()).id,id);
   assert.equal((await normal(request(approval))).status,200);assert.equal((await admin.query('select count(*)::int as n from app.payment_refund_approvals where payment_intent_id=$1',[item.id])).rows[0].n,1);
   await load('placement-refund-worker').createPlacementRefundWorker(refundDb,shop,async(url,init)=>{if(init.method==='GET'&&String(url).includes('/v3/refunds/'))throw Error('Synthetic GET outage');return remote.fetcher(url,init);}).tick();
   const page=await (await normal(request({action:'list',expectedAdminId:operator.id,input:null}))).json(),row=page.items.find(row=>row.id===item.id);assert.equal(row.operationId,id);assert.equal(row.attempted,true);assert.ok(row.providerRefundId);
   const command={action:'recover',expectedAdminId:operator.id,input:{id:randomUUID(),operationId:id,providerRefundId:row.providerRefundId,reason:'Сверка через локальную админку.'}};
   const recovered=await normal(request(command));assert.equal(recovered.status,200);assert.equal((await recovered.json()).state,'applied');offline=true;
   assert.equal((await normal(request(command))).status,200);assert.equal(remote.posts(),1);
   const final=await (await normal(request({action:'list',expectedAdminId:operator.id,input:null}))).json();assert.equal(final.items[0].refundStatus,'succeeded');assert.ok(final.items[0].appliedAt);
   assert.equal((await admin.query('select count(*)::int as n from app.payment_refund_effects where operation_id=$1',[id])).rows[0].n,1);assert.equal((await admin.query('select count(*)::int as n from app.notifications where event_key=$1',['placement_refund:'+item.id])).rows[0].n,1);
  }finally{await service.close();}
 });
 await suite.test('journal retains a GET-proven refund whose original send response and candidate were lost',async()=>{
  const shop={...merchant,shopId:'admin-no-candidate-'+randomBytes(6).toString('hex')},item=await purchase({scope:shop}),id=randomUUID(),remote=provider(item,id,shop);let known;
  const runtime=await createLocalRefundOperatorRuntime(environment(shop),{fetcher:async(url,init)=>url==='https://api.yookassa.ru/v3/me'?Response.json({account_id:shop.shopId,test:true,status:'enabled',fiscalization:{enabled:false}}):remote.fetcher(url,init)}),service=await startLocalRefundOperatorServer(runtime);
  try{
   const invoke=handler(service);assert.equal((await invoke(request({action:'approve',expectedAdminId:operator.id,input:{id,paymentIntentId:item.id,reason:'Проверка потери исходного ответа.'}}))).status,200);
   await load('placement-refund-worker').createPlacementRefundWorker(refundDb,shop,async(url,init)=>{
    const response=await remote.fetcher(url,init);if(init.method==='POST'){const seen=(await response.json()).id;if(known)assert.equal(seen,known);known=seen;throw Error('Synthetic lost POST response');}return response;
   }).tick();assert.ok(known);const originalPosts=remote.posts();assert.equal(originalPosts,3);assert.equal((await admin.query('select count(*)::int as n from app.payment_refund_candidates where operation_id=$1',[id])).rows[0].n,0);
   const before=await (await invoke(request({action:'list',expectedAdminId:operator.id,input:null}))).json();assert.equal(before.items[0].attempted,true);assert.equal(before.items[0].providerRefundId,null);
   const recovered=await invoke(request({action:'recover',expectedAdminId:operator.id,input:{id:randomUUID(),operationId:id,providerRefundId:known,reason:'Сверка по известному номеру ЮKassa.'}}));assert.equal(recovered.status,200);assert.equal((await recovered.json()).state,'applied');
   const after=await (await invoke(request({action:'list',expectedAdminId:operator.id,input:null}))).json();assert.equal(after.items[0].providerRefundId,known);assert.equal(after.items[0].refundStatus,'succeeded');assert.ok(after.items[0].appliedAt);assert.equal(remote.posts(),originalPosts);
  }finally{await service.close();}
 });
 for(const event of events)assert.deepEqual(Object.keys(event).filter(key=>!['event','requestId','status','durationMs','code'].includes(key)),[]);
}
