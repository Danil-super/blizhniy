import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createApplicationsClient,ApplicationClientError} from '../src/lib/client-applications.ts';
const owner='10000000-0000-4000-8000-000000000001',id='10000000-0000-4000-8000-000000000002',targetId='10000000-0000-4000-8000-000000000003',specialistId='10000000-0000-4000-8000-000000000004',key='10000000-0000-4000-8000-000000000005';
const stamp='2026-10-19T00:00:00.123456Z',snapshot={name:'Синтетический специалист',profession:'Мастер',price:'100.00',skills:'Ремонт',phone:null,email:'fixture@example.invalid',messengerUrl:null};
const input={kind:'vacancy',targetId,creationKey:key,expectedTargetRevision:'9007199254740993',specialistId,expectedSpecialistRevision:'7',message:'Могу помочь'};
const saved={id,revision:'1',view:'applicant',target:{id:targetId,kind:'vacancy',title:'Синтетическая вакансия'},specialistId,snapshot,message:input.message,status:'pending_payment',paid:false,sentAt:null,createdAt:stamp,updatedAt:stamp};
const preview={target:{...saved.target,revision:input.expectedTargetRevision},specialist:{id:specialistId,revision:'7',snapshot},existing:null};
test('compose client reads authoritative preview, creates once by cookie with exact reviewed revisions, and recovers the original intent',async()=>{
 const calls=[],client=createApplicationsClient(async(path,init)=>{const body=JSON.parse(init.body);calls.push({path,init,body});return Response.json(body.action==='preview'?preview:saved);});
 assert.deepEqual(await client.preview(owner,'vacancy',targetId),preview);
 assert.deepEqual(await client.create(owner,input),saved);
 assert.deepEqual(await client.intent(owner,key),saved);
 for(const {path,init,body} of calls){assert.equal(path,'/api/account/applications');assert.equal(init.credentials,'same-origin');assert.equal(init.redirect,'error');assert.equal(init.cache,'no-store');assert.equal(init.headers.Authorization,undefined);assert.equal(body.expectedOwnerId,owner);}
 assert.equal(calls[0].init.method,'POST');assert.equal(calls[1].init.method,'PUT');assert.equal(calls[2].init.method,'POST');assert.deepEqual(calls[1].body.input,input);assert.equal(calls[2].body.creationKey,key);
 let writes=0;await assert.rejects(createApplicationsClient(async()=>{writes++;throw Error('Lost reply');}).create(owner,input),ApplicationClientError);assert.equal(writes,1);
 assert.equal(await createApplicationsClient(async()=>Response.json(null)).intent(owner,key),null);
});
test('compose preview rejects private extra fields, swapped target/kind, broken revisions and mismatched existing application',async()=>{
 for(const bad of [{...preview,secret:'no'},{...preview,target:{...preview.target,id:owner}},{...preview,target:{...preview.target,kind:'workRequest'}},
  {...preview,target:{...preview.target,revision:7}},{...preview,specialist:{...preview.specialist,snapshot:{...snapshot,secret:'no'}}},
  {...preview,existing:{...saved,target:{...saved.target,id:owner}}},{...preview,existing:{...saved,view:'recipient',status:'sent',paid:true,sentAt:stamp}}]){
  await assert.rejects(createApplicationsClient(async()=>Response.json(bad)).preview(owner,'vacancy',targetId),ApplicationClientError);
 }
 assert.deepEqual(await createApplicationsClient(async()=>Response.json({...preview,existing:saved})).preview(owner,'vacancy',targetId),{...preview,existing:saved});
});
test('compose acknowledgement rejects another target, specialist, message or view; invalid input never reaches transport',async()=>{
 for(const bad of [{...saved,target:{...saved.target,id:owner}},{...saved,target:{...saved.target,kind:'workRequest'}},{...saved,specialistId:owner},{...saved,message:'Другой текст'},
  {...saved,view:'recipient',status:'sent',paid:true,sentAt:stamp}])await assert.rejects(createApplicationsClient(async()=>Response.json(bad)).create(owner,input),ApplicationClientError);
 let calls=0;const client=createApplicationsClient(async()=>{calls++;return Response.json(saved);});
 for(const bad of [{...input,paid:true},{...input,message:'x'.repeat(3001)},{...input,message:'\u0000'},{...input,expectedTargetRevision:1}])await assert.rejects(client.create(owner,bad),ApplicationClientError);
 assert.equal(calls,0);
 await assert.rejects(createApplicationsClient(async()=>Response.json({...saved,view:'recipient',status:'sent',paid:true,sentAt:stamp})).intent(owner,key),ApplicationClientError);
});
