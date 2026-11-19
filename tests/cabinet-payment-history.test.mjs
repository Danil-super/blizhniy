import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import test from 'node:test';
import {loadAdminModule} from './admin-module.mjs';
const require=createRequire(import.meta.url),ts=require('typescript'),modules=new Map();
function load(name){
 if(modules.has(name))return modules.get(name);
 const exports={};
 const source=readFileSync(new URL(`../src/lib/${name}.ts`,import.meta.url),'utf8');
 new Function('require','exports',ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(path=>{
  if(path==='./app-session-transaction')return loadAdminModule('app-session-transaction');
  if(path.startsWith('./'))return load(path.slice(2).replace(/\.ts$/,''));
  return require(path);
 },exports);modules.set(name,exports);return exports;
}
const owner='11111111-1111-4111-8111-111111111111',id='22222222-2222-4222-8222-222222222222',token='a'.repeat(64),origin='https://example.invalid';
const stamp='2026-11-13T12:00:00.123456Z';
const item=(overrides={})=>({id,targetType:'listing',amount:'199.00',status:'succeeded',isTest:true,createdAt:stamp,...overrides});
const request=(body={expectedOwnerId:owner,cursor:null},options={})=>new Request(origin+'/api/account/payments',{method:'POST',headers:{host:'example.invalid',origin,'content-type':'application/json','x-blizhniy-request':'1','sec-fetch-site':'same-origin','x-real-ip':'127.0.0.1',cookie:'__Host-blizhniy_session='+token,...options.headers},body:JSON.stringify(body)});

test('payment history parses an exact bounded page with microsecond seek cursor',()=>{
 const {parsePaymentHistoryPage,parsePaymentHistoryInput}=load('payment-history-contract');
 const value={items:[item()],nextCursor:null};assert.deepEqual(parsePaymentHistoryPage(value,null),value);
 assert.deepEqual(parsePaymentHistoryInput({expectedOwnerId:owner,cursor:{id,createdAt:stamp}}),{expectedOwnerId:owner,cursor:{id,createdAt:stamp}});
 for(const bad of [{expectedOwnerId:owner,cursor:null,ownerId:id},{expectedOwnerId:owner,cursor:{id,createdAt:'2026-02-30T00:00:00.000000Z'}},{expectedOwnerId:'bad',cursor:null}])assert.throws(()=>parsePaymentHistoryInput(bad));
 for(const bad of [{...value,secret:'no'}, {items:Array(51).fill(item()),nextCursor:null},{items:[item({amount:199})],nextCursor:null},{items:[item({status:'paid'})],nextCursor:null},{items:[item({targetType:'unknown'})],nextCursor:null},{items:[item({isTest:1})],nextCursor:null},{items:[item(),item()],nextCursor:null},{items:[item()],nextCursor:{id,createdAt:stamp}}])assert.throws(()=>parsePaymentHistoryPage(bad,null));
});

test('history read authorizes the current owner and binds cursor values without financial writes',async()=>{
 const calls=[];const db={transaction:work=>work({query:async(sql,args)=>{calls.push({sql,args});
  if(sql.startsWith('select u.id'))return {rowCount:1,rows:[{id:owner,role:'user',isBlocked:false,verified:true,authVersion:'0'}]};
  if(sql.includes('from app.payment_orders'))return {rowCount:1,rows:[item()]};
  return {rowCount:1,rows:[]};
 }})};
 const {PostgresPaymentHistoryStore}=load('postgres-payment-history');const store=new PostgresPaymentHistoryStore(db);
 assert.deepEqual(await store.list(token,owner,null),{items:[item()],nextCursor:null});
 const query=calls.find(call=>call.sql.includes('from app.payment_orders'));
 assert.deepEqual(query.args,[owner]);assert.match(query.sql,/o\.owner_id=\$1/);assert.match(query.sql,/i\.owner_id=o\.owner_id/);assert.match(query.sql,/limit 51/i);assert.match(query.sql,/order by o\.created_at desc,o\.id desc/);
 assert.equal(calls.some(call=>/^(insert|delete|update app\.payment)/i.test(call.sql)),false);
 await assert.rejects(store.list(token,id,null));
 const boundary='2026-11-13T12:00:01.123456Z';calls.length=0;await store.list(token,owner,{id,createdAt:boundary});
 assert.deepEqual(calls.find(call=>call.sql.includes('from app.payment_orders')).args,[owner,boundary,id]);
});

test('history HTTP boundary rejects invalid origins, missing sessions, extra keys, rate limits and hides internal failures',async()=>{
 const {createPaymentHistoryHandler}=load('payment-history-http');let reads=0,factories=0;const events=[];
 const handler=createPaymentHistoryHandler({origin},()=>{factories++;return {store:{list:async(...args)=>{reads++;assert.deepEqual(args,[token,owner,null]);return {items:[item()],nextCursor:null};}},limiter:{allowProduction:async()=>true}};},event=>events.push(event));
 const response=await handler(request());assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');assert.deepEqual(await response.json(),{items:[item()],nextCursor:null});
 for(const [req,status] of [[request(undefined,{headers:{origin:'https://foreign.invalid'}}),403],[request(undefined,{headers:{cookie:''}}),401],[request({expectedOwnerId:owner,cursor:null,token}),422],[new Request(origin+'/api/account/payments'),405]])assert.equal((await handler(req)).status,status);
 assert.equal(reads,1);assert.equal(factories,1);
 const limited=createPaymentHistoryHandler({origin},()=>({store:{list:()=>assert.fail()},limiter:{allowProduction:async()=>false}}),()=>{});const denied=await limited(request());assert.equal(denied.status,429);assert.equal(denied.headers.get('retry-after'),'900');
 const failed=createPaymentHistoryHandler({origin},()=>{throw Error('private SQL credentials');},()=>{});assert.deepEqual(await (await failed(request())).json(),{error:{code:'PAYMENT_HISTORY_UNAVAILABLE'}});
 assert.equal(JSON.stringify(events).includes(token),false);
});

test('payment history client uses cookie POST, handles bounded responses and never substitutes an empty history',async()=>{
 const {createPaymentHistoryClient}=load('client-payment-history');const calls=[];
 const client=createPaymentHistoryClient(async(url,init)=>{calls.push({url,init});return Response.json({items:[item()],nextCursor:null});});
 assert.equal((await client.list(owner,null)).items[0].amount,'199.00');assert.equal(calls[0].url,'/api/account/payments');assert.equal(calls[0].init.credentials,'same-origin');assert.equal(calls[0].init.cache,'no-store');assert.equal(calls[0].init.redirect,'error');assert.deepEqual(JSON.parse(calls[0].init.body),{expectedOwnerId:owner,cursor:null});
 for(const response of [Response.json({error:{code:'UNAUTHENTICATED'}},{status:401}),Response.json({items:[],nextCursor:null},{status:503}),new Response('x'.repeat(40000))])await assert.rejects(createPaymentHistoryClient(async()=>response).list(owner,null));
 const controller=new AbortController();controller.abort();let touched=false;await assert.rejects(createPaymentHistoryClient(async()=>{touched=true;}).list(owner,null,{signal:controller.signal}));assert.equal(touched,false);
});

test('history pagination preserves same-timestamp UUID order and yields every status exactly once',async()=>{
 const {PostgresPaymentHistoryStore}=load('postgres-payment-history');
 const rows=Array.from({length:51},(_,index)=>item({id:`22222222-2222-4222-8222-${String(100-index).padStart(12,'0')}`,status:['created','pending','succeeded','failed','refunded'][index%5]}));
 const db={transaction:work=>work({query:async(sql,args)=>{
  if(sql.startsWith('select u.id'))return {rowCount:1,rows:[{id:owner,role:'user',isBlocked:false,verified:true,authVersion:'0'}]};
  if(sql.includes('from app.payment_orders'))return {rowCount:args.length===1?51:1,rows:args.length===1?rows:[rows[50]]};
  return {rowCount:1,rows:[]};
 }})};
 const store=new PostgresPaymentHistoryStore(db),first=await store.list(token,owner,null),second=await store.list(token,owner,first.nextCursor);
 assert.equal(first.items.length,50);assert.deepEqual(first.nextCursor,{id:rows[49].id,createdAt:stamp});assert.equal(second.items.length,1);assert.equal(second.nextCursor,null);
 assert.equal(new Set([...first.items,...second.items].map(row=>row.id)).size,51);assert.deepEqual(new Set(first.items.map(row=>row.status)),new Set(['created','pending','succeeded','failed','refunded']));
});

test('history cannot read data for blocked, unverified or expired sessions and final session expiry discards a result',async()=>{
 const {PostgresPaymentHistoryStore}=load('postgres-payment-history');
 for(const scenario of ['blocked','unverified','expired','final-expiry']){
  let selected=0;const db={transaction:work=>work({query:async(sql)=>{
   if(sql.startsWith('select u.id'))return {rowCount:1,rows:[{id:owner,role:'user',isBlocked:scenario==='blocked',verified:scenario!=='unverified',authVersion:'0'}]};
   if(sql.includes('from app.payment_orders')){selected++;return {rowCount:1,rows:[item()]};}
   if(sql.startsWith('select token_hash'))return {rowCount:scenario==='expired'?0:1,rows:[]};
   return {rowCount:scenario==='final-expiry'?0:1,rows:[]};
  }})};
  await assert.rejects(new PostgresPaymentHistoryStore(db).list(token,owner,null));assert.equal(selected,scenario==='final-expiry'?1:0);
 }
});

test('a payment bookmark reads only the requested purchase through the owner history API',async()=>{
 const {createPaymentHistoryHandler}=load('payment-history-http'),{createPaymentHistoryClient}=load('client-payment-history');
 for(const targetType of ['listing','vacancy','workRequest','application']){
  const receipt={id,targetType},row=item({targetType});let reads=0;
  const handler=createPaymentHistoryHandler({origin},()=>({limiter:{allowProduction:async()=>true},store:{list:async(...args)=>{
   assert.deepEqual(args,[token,owner,receipt]);reads++;return {items:[row],nextCursor:null};
  }}}),()=>{});
  const client=createPaymentHistoryClient(async(url,init)=>{
   assert.equal(url,'/api/account/payments');assert.equal(init.method,'POST');
   return handler(request(JSON.parse(init.body)));
  });
  assert.deepEqual(await client.list(owner,null,{receipt}),{items:[row],nextCursor:null});assert.equal(reads,1);
  for(const body of [{expectedOwnerId:owner,receipt,cursor:null},{expectedOwnerId:owner,receipt:{id,targetType:'specialist'}},{expectedOwnerId:owner,receipt:{id:'broken',targetType}}]){
   assert.equal((await handler(request(body))).status,422);
  }
  assert.equal(reads,1);
  for(const items of [[item({id:owner,targetType})],[item({targetType:targetType==='listing'?'vacancy':'listing'})],[row,row]]){
   await assert.rejects(createPaymentHistoryClient(async()=>Response.json({items,nextCursor:null})).list(owner,null,{receipt}));
  }
 }
});
