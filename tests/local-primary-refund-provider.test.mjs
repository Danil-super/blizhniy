import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createLocalPrimaryRefundProvider} from '../scripts/local-primary-refund-provider.mjs';

const unavailable={message:'Local refund simulator unavailable'};
const state={origin:'https://127.0.0.1:3045',database:'blizhniy_prod'};
const authorization='Basic '+Buffer.from('local-fixture-shop:test_local-fixture-never-a-real-key').toString('base64');
async function local(work){
 const saved={...process.env};Object.assign(process.env,{NODE_ENV:'test',BLIZHNIY_LOCAL_PRIMARY:'enabled',BLIZHNIY_LOCAL_PRIMARY_ORIGIN:state.origin});
 try{return await work();}finally{for(const key of Object.keys(process.env))if(!(key in saved))delete process.env[key];Object.assign(process.env,saved);}
}
test('simulator refuses nonlocal configuration and foreign database before creating any provider state',()=>local(async()=>{
 for(const change of [{NODE_ENV:'production'},{BLIZHNIY_LOCAL_PRIMARY:'disabled'},{BLIZHNIY_LOCAL_PRIMARY_ORIGIN:'https://foreign.invalid'}]){
  const saved={...process.env};Object.assign(process.env,change);let reads=0;
  await assert.rejects(createLocalPrimaryRefundProvider({state,ownerDb:{query:async()=>{reads++;throw Error('private credential');}}}),unavailable);
  assert.equal(reads,0);Object.assign(process.env,saved);
 }
 let reads=0;await assert.rejects(createLocalPrimaryRefundProvider({state,ownerDb:{query:async()=>{reads++;return{rows:[{database:'foreign'}]};}}}),unavailable);assert.equal(reads,1);
}));
test('fixed synthetic merchant has no network fallback; invalid requests and aborted calls cause no database work',()=>local(async()=>{
 const calls=[],ownerDb={query:async sql=>{calls.push(sql);return{rows:[{database:'blizhniy_prod',role:'postgres'}]};}};
 const fetcher=await createLocalPrimaryRefundProvider({state,ownerDb});const before=calls.length;
 assert.deepEqual(await(await fetcher('https://api.yookassa.ru/v3/me',{method:'GET',headers:{authorization}})).json(),{account_id:'local-fixture-shop',test:true,status:'enabled',fiscalization:{enabled:false}});
 const id='00000000-0000-4000-8000-000000000001',headers={authorization,'content-type':'application/json','idempotence-key':'refund-'+id};
 const cases=[
  ['https://foreign.invalid/v3/me',{headers:{authorization}}],
  ['https://user@api.yookassa.ru/v3/me',{headers:{authorization}}],
  ['https://api.yookassa.ru/v3/me#fragment',{headers:{authorization}}],
  ['https://api.yookassa.ru/v3/me',{headers:{authorization:'Basic foreign'}}],
  ['https://api.yookassa.ru/v3/me',{method:'POST',headers:{authorization}}],
  ['https://api.yookassa.ru/v3/refunds?payment_id='+id+'&limit=100&limit=100',{headers:{authorization}}],
  ['https://api.yookassa.ru/v3/refunds',{method:'POST',headers,body:'x'.repeat(4097)}],
  ['https://api.yookassa.ru/v3/refunds',{method:'POST',headers:{...headers,'idempotence-key':'foreign'},body:'{}'}],
  ['https://api.yookassa.ru/v3/refunds',{method:'POST',headers:{...headers,'content-type':'text/plain'},body:'{}'}],
 ];
 const controller=new AbortController();controller.abort();cases.push(['https://api.yookassa.ru/v3/me',{headers:{authorization},signal:controller.signal}]);
 for(const [url,init] of cases){await assert.rejects(fetcher(url,init),unavailable);assert.equal(calls.length,before);}
}));
