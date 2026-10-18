import assert from 'node:assert/strict';import {test} from 'node:test';
import {createApplicationsClient,ApplicationClientError} from '../src/lib/client-applications.ts';
const owner='10000000-0000-4000-8000-000000000001',id='10000000-0000-4000-8000-000000000002',targetId='10000000-0000-4000-8000-000000000003',specialistId='10000000-0000-4000-8000-000000000004';
const stamp='2026-10-18T00:00:00.123456Z',summary={id,revision:'9007199254740993',view:'applicant',status:'pending_payment',paid:false,createdAt:stamp,targetId,kind:'vacancy',targetTitle:'Синтетическая вакансия',specialistName:'Тестовый специалист'};
const detail={id,revision:summary.revision,view:'applicant',target:{id:targetId,kind:'vacancy',title:summary.targetTitle},specialistId,snapshot:{name:summary.specialistName,profession:'Мастер',price:'100.00',skills:'Ремонт',phone:null,email:'fixture@example.invalid',messengerUrl:null},message:'',status:'pending_payment',paid:false,sentAt:null,createdAt:stamp,updatedAt:stamp};
test('application client binds exact owner/ID/CAS to bounded cookie requests without bearer, persistence or automatic write retries',async()=>{
 const decided={...detail,view:'recipient',status:'selected',paid:true,sentAt:stamp,revision:'9007199254740994'};
 const calls=[],client=createApplicationsClient(async(path,init)=>{const body=JSON.parse(init.body);calls.push({path,init,body});return Response.json(body.action==='list'?{items:[summary],nextCursor:null}:body.action==='decide'?decided:detail);});
 assert.deepEqual(await client.list(owner,'applicant',null),{items:[summary],nextCursor:null});assert.deepEqual(await client.read(owner,id),detail);
 assert.deepEqual(await client.decide(owner,id,summary.revision,'selected'),decided);
 for(const call of calls){assert.equal(call.path,'/api/account/applications');assert.equal(call.init.credentials,'same-origin');assert.equal(call.init.redirect,'error');assert.equal(call.init.cache,'no-store');assert.equal(call.init.headers.Authorization,undefined);assert.equal(call.body.expectedOwnerId,owner);}
 assert.equal(calls[0].init.method,'POST');assert.equal(calls[2].init.method,'PUT');assert.equal(calls[2].body.expectedRevision,summary.revision);
 let writes=0;await assert.rejects(createApplicationsClient(async()=>{writes++;throw Error('Lost acknowledgement');}).decide(owner,id,'1','selected'),ApplicationClientError);assert.equal(writes,1);
});
test('application client rejects foreign details, leaked participant fields, impossible delivery state and malformed bounded snapshots',async()=>{
 for(const bad of [{...detail,id:targetId},{...detail,applicant:owner},{...detail,revision:9007199254740993},{...detail,paid:true},{...detail,status:'sent'},
  {...detail,view:'recipient'},{...detail,updatedAt:'2026-10-18T00:00:00.123Z'},{...detail,snapshot:{...detail.snapshot,secret:'bad'}},
  {...detail,snapshot:{...detail.snapshot,skills:'x'.repeat(501)}},{...detail,message:'\u0000'},{...detail,target:{...detail.target,owner} }]){
  await assert.rejects(createApplicationsClient(async()=>Response.json(bad)).read(owner,id),ApplicationClientError);
 }
 const delivered={...detail,view:'recipient',status:'sent',paid:true,sentAt:stamp};assert.deepEqual(await createApplicationsClient(async()=>Response.json(delivered)).read(owner,id),delivered);
 for(const items of [[summary,summary],[{...summary,view:'recipient'}],[{...summary,snapshot:detail.snapshot}]])await assert.rejects(createApplicationsClient(async()=>Response.json({items,nextCursor:null})).list(owner,'applicant',null),ApplicationClientError);
 await assert.rejects(createApplicationsClient(async()=>Response.json({items:[summary],nextCursor:{id,updatedAt:stamp}})).list(owner,'applicant',null),ApplicationClientError);
 await assert.rejects(createApplicationsClient(async()=>Response.json({items:[summary],nextCursor:null})).list(owner,'applicant',{id,updatedAt:stamp}),ApplicationClientError);
});
test('application client caps UTF8 bytes/chunks, handles cancellation and only classifies matching structured errors',async()=>{
 for(const response of [()=>new Response('x'.repeat(524289)),()=>new Response('{'),()=>new Response(new Uint8Array([0xff]))])await assert.rejects(createApplicationsClient(async()=>response()).read(owner,id),ApplicationClientError);
 let cancelled=false;const stream=new ReadableStream({pull(c){c.enqueue(new Uint8Array([32]));},cancel(){cancelled=true;}});await assert.rejects(createApplicationsClient(async()=>new Response(stream)).read(owner,id),ApplicationClientError);assert.equal(cancelled,true);
 let calls=0;const signal=AbortSignal.abort();await assert.rejects(createApplicationsClient(async()=>{calls++;return Response.json(detail);}).read(owner,id,{signal}),ApplicationClientError);assert.equal(calls,0);
 for(const [status,code,expected] of [[401,'UNAUTHENTICATED','UNAUTHENTICATED'],[409,'APPLICATION_CHANGED','APPLICATION_CHANGED'],[409,'APPLICATION_BUSY','APPLICATION_BUSY'],[404,'APPLICATION_NOT_FOUND','APPLICATION_NOT_FOUND'],[500,'UNAUTHENTICATED','UNKNOWN'],[503,'APPLICATIONS_UNAVAILABLE','UNKNOWN']]){
  await assert.rejects(createApplicationsClient(async()=>Response.json({error:{code}},{status})).read(owner,id),error=>error.code===expected);
 }
});
test('a decision acknowledgement must match the requested application, recipient, outcome and exact adjacent bigint revision',async()=>{
 const result={...detail,view:'recipient',status:'selected',paid:true,sentAt:stamp,revision:'9007199254740994'};
 for(const invalid of [{...result,id:targetId},{...result,view:'applicant'},{...result,status:'rejected'},{...result,revision:'9007199254740995'}]){
  await assert.rejects(createApplicationsClient(async()=>Response.json(invalid)).decide(owner,id,summary.revision,'selected'),ApplicationClientError);
 }
 let calls=0;await assert.rejects(createApplicationsClient(async()=>{calls++;return Response.json(result);}).decide(owner,id,'1','sent'),ApplicationClientError);assert.equal(calls,0);
});
