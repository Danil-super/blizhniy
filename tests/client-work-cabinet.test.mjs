import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createWorkCabinetClient} from '../src/lib/client-work-cabinet.ts';
const owner='11111111-1111-4111-8111-111111111111';
test('work cabinet sends one bounded cookie-only same-origin read with exact microsecond cursor',async()=>{
 const cursor={id:owner,updatedAt:'2026-10-21T00:00:00.123456Z'},calls=[];
 const client=createWorkCabinetClient(async(path,init)=>{calls.push({path,init});return Response.json({items:[],nextCursor:null});});
 assert.deepEqual(await client.list(owner,'vacancy',cursor),{items:[],nextCursor:null});
 assert.equal(calls.length,1);const {path,init}=calls[0];
 assert.equal(path,'/api/account/work-cabinet');assert.equal(init.method,'POST');assert.equal(init.credentials,'same-origin');
 assert.equal(init.cache,'no-store');assert.equal(init.redirect,'error');assert.equal(init.headers['X-Blizhniy-Request'],'1');
 assert.ok(init.signal instanceof AbortSignal);assert.equal(Object.hasOwn(init.headers,'Authorization'),false);
 assert.deepEqual(JSON.parse(init.body),{kind:'vacancy',expectedOwnerId:owner,after:cursor});
});
test('work cabinet rejects malformed input before transport and never retries failed or oversized reads',async()=>{
 let calls=0;const client=createWorkCabinetClient(async()=>{calls++;return Response.json({items:[],nextCursor:null});});
 const controller=new AbortController();controller.abort();
 await assert.rejects(()=>client.list('bad','vacancy',null),{code:'UNKNOWN'});
 await assert.rejects(()=>client.list(owner,'other',null),{code:'UNKNOWN'});
 await assert.rejects(()=>client.list(owner,'vacancy',null,{signal:controller.signal}),{code:'UNKNOWN'});assert.equal(calls,0);
 for(const [status,body,code] of [[401,{error:{code:'UNAUTHENTICATED'}},'UNAUTHENTICATED'],[429,{error:{code:'RATE_LIMITED'}},'RATE_LIMITED'],
  [503,{error:{code:'UNAUTHENTICATED',secret:'SQL'}},'UNKNOWN'],[200,{items:[],nextCursor:null,secret:'SQL'},'UNKNOWN']]){
  let attempts=0;const failed=createWorkCabinetClient(async()=>{attempts++;return Response.json(body,{status});});
  await assert.rejects(()=>failed.list(owner,'vacancy',null),error=>error.code===code&&!error.message.includes('SQL'));assert.equal(attempts,1);
 }
 let attempts=0;const oversized=createWorkCabinetClient(async()=>{attempts++;return new Response(' '.repeat(262145));});
 await assert.rejects(()=>oversized.list(owner,'vacancy',null),{code:'UNKNOWN'});assert.equal(attempts,1);
});
