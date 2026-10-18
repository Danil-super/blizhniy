import assert from 'node:assert/strict';import {test} from 'node:test';
import {createWorkModerationClient} from '../src/lib/client-work-moderation.ts';
import {parseWorkPublicationForm} from '../src/lib/work-publication-contract.ts';
const owner='11111111-1111-4111-8111-111111111111',id='22222222-2222-4222-8222-222222222222',review='33333333-3333-4333-8333-333333333333',revision='9007199254740993';
test('owner work moderation uses cookie-only exact revision envelopes and validates state',async()=>{
 const calls=[],value={id:review,revision,state:'pending',note:null},client=createWorkModerationClient(async(path,init)=>{calls.push([path,init]);return Response.json(value);});
 assert.deepEqual(await client.read(owner,'vacancy',id,revision),value);assert.deepEqual(await client.submit(owner,'vacancy',id,revision),value);
 for(const [path,init] of calls){assert.equal(path,'/api/account/work-moderation');assert.equal(init.credentials,'same-origin');assert.equal(init.redirect,'error');assert.equal(init.cache,'no-store');
  assert.deepEqual(JSON.parse(init.body),{expectedOwnerId:owner,kind:'vacancy',publicationId:id,expectedRevision:revision});}
 assert.deepEqual(calls.map(c=>c[1].method),['POST','PUT']);
});
test('work moderation unknown transport/state never retries, private details are not error messages',async()=>{
 for(const reply of [()=>{throw Error('synthetic-private-email@example.invalid');},()=>Response.json({id:review,revision:'1',state:'approved',note:null}),()=>Response.json({error:{code:'PRIVATE'}},{status:503})]){
  let calls=0;const client=createWorkModerationClient(async()=>{calls++;return reply();});await assert.rejects(()=>client.submit(owner,'vacancy',id,revision),error=>error.code==='UNKNOWN'&&!error.message.includes('@'));assert.equal(calls,1);}
});
test('admin work client validates queue, complete detail, exact decision and private image transport',async()=>{
 const calls=[],stamp='2026-10-18T00:00:00.123456Z',item={id:review,publicationId:id,kind:'workRequest',revision,title:'Технический',updatedAt:stamp};
 const snapshot={id,kind:'workRequest',revision,status:'draft',paid:false,form:parseWorkPublicationForm('workRequest',{title:item.title}),photos:[],createdAt:stamp,updatedAt:stamp,publishedAt:null,expiresAt:null};
 const client=createWorkModerationClient(async(path,init)=>{calls.push([path,init]);const body=JSON.parse(init.body);
  return body.action==='list'?Response.json({items:[item],nextCursor:null}):body.action==='inspect'?Response.json({request:{id:review,revision,state:'pending',note:null},snapshot,issues:[]}):body.action==='photo'?new Response(new Uint8Array(12),{headers:{'Content-Type':'image/webp'}}):Response.json({id:review,revision,state:'approved',note:null});});
 assert.deepEqual((await client.adminList(owner,null)).items,[item]);assert.equal((await client.adminInspect(owner,item)).snapshot.id,id);
 assert.equal((await client.adminDecide(owner,item,'approved',null)).state,'approved');assert.equal((await client.adminPhoto(owner,review,id)).type,'image/webp');
 for(const [path,init] of calls){assert.equal(path,'/api/admin/work-moderation');assert.equal(JSON.parse(init.body).expectedAdminId,owner);assert.equal(init.credentials,'same-origin');}
 assert.deepEqual(JSON.parse(calls[2][1].body),{expectedAdminId:owner,requestId:review,state:'approved',note:null});
});
