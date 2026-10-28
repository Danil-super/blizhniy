import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createApplicationsClient,ApplicationClientError} from '../src/lib/client-applications.ts';

const owner='10000000-0000-4000-8000-000000000001',id='10000000-0000-4000-8000-000000000002',targetId='10000000-0000-4000-8000-000000000003',specialistId='10000000-0000-4000-8000-000000000004';
const stamp='2026-10-26T08:00:00.123456Z';
const input={applicationId:id,expectedRevision:'9007199254740993',expectedTargetRevision:'5',specialistId,expectedSpecialistRevision:'7',message:'Уточнённое сообщение'};
const saved={id,revision:'9007199254740994',view:'applicant',target:{id:targetId,kind:'workRequest',title:'Синтетический заказ'},specialistId,
 snapshot:{name:'Анна',profession:'Сантехник',price:'1500.00',skills:'О себе',about:'О'.repeat(3000),phone:null,email:'fixture@example.invalid',messengerUrl:null},
 message:input.message,status:'pending_payment',paid:false,sentAt:null,createdAt:stamp,updatedAt:stamp};

test('application edit client sends exact reviewed input by cookie PUT and preserves the full about snapshot',async()=>{
 const calls=[],client=createApplicationsClient(async(path,init)=>{calls.push({path,init,body:JSON.parse(init.body)});return Response.json(saved);});
 assert.equal(typeof client.update,'function','saved applications need a first-class edit operation');
 assert.deepEqual(await client.update(owner,input),saved);
 assert.equal(calls.length,1);const {path,init,body}=calls[0];
 assert.equal(path,'/api/account/applications');assert.equal(init.method,'PUT');assert.equal(init.credentials,'same-origin');assert.equal(init.redirect,'error');assert.equal(init.cache,'no-store');
 assert.equal(init.headers.Authorization,undefined);assert.equal(init.headers['X-Blizhniy-Request'],'1');
 assert.deepEqual(body,{action:'update',expectedOwnerId:owner,input});
});

test('application edit rejects malformed CAS and hidden financial fields before transport',async()=>{
 let writes=0;const client=createApplicationsClient(async()=>{writes++;return Response.json(saved);});
 assert.equal(typeof client.update,'function');
 for(const invalid of [{...input,applicationId:'bad'},{...input,expectedRevision:1},{...input,expectedTargetRevision:'0'},{...input,expectedSpecialistRevision:'01'},
  {...input,paid:true},{...input,message:'bad\u0000'},{...input,message:'<script>alert(1)</script>'},{...input,message:'x'.repeat(3001)}]){
  await assert.rejects(client.update(owner,invalid),ApplicationClientError);
 }
 assert.equal(writes,0);
});

test('application edit rejects swapped identities, wrong message/view, and non-advancing or imprecise CAS acknowledgements',async()=>{
 for(const invalid of [{...saved,id:owner},{...saved,specialistId:owner},{...saved,message:'Не те данные'},{...saved,view:'recipient',status:'sent',paid:true,sentAt:stamp},
  {...saved,revision:input.expectedRevision},{...saved,revision:'9007199254740995'},{...saved,revision:9007199254740994}]){
  const client=createApplicationsClient(async()=>Response.json(invalid));assert.equal(typeof client.update,'function');
  await assert.rejects(client.update(owner,input),ApplicationClientError);
 }
});

test('application edit rejects extra response fields, invalid financial state, and malformed about text',async()=>{
 for(const invalid of [{...saved,secret:'no'},{...saved,status:'pending_payment',paid:true},{...saved,status:'sent',paid:true,sentAt:stamp},{...saved,sentAt:stamp},{...saved,snapshot:{...saved.snapshot,about:'x'.repeat(3001)}},
  {...saved,snapshot:{...saved.snapshot,about:'bad\u0000'}},{...saved,snapshot:{...saved.snapshot,privateUserId:owner}}]){
  const client=createApplicationsClient(async()=>Response.json(invalid));assert.equal(typeof client.update,'function');
  await assert.rejects(client.update(owner,input),ApplicationClientError);
 }
});

test('application edit reports a lost acknowledgement without automatically repeating the write',async()=>{
 let writes=0;const client=createApplicationsClient(async()=>{writes++;throw Error('Lost reply');});assert.equal(typeof client.update,'function');
 await assert.rejects(client.update(owner,input),ApplicationClientError);assert.equal(writes,1);
});

test('application edit preserves authoritative conflict and busy errors for explicit recovery',async()=>{
 for(const code of ['APPLICATION_CHANGED','APPLICATION_BUSY']){
  const client=createApplicationsClient(async()=>Response.json({error:{code}},{status:409}));assert.equal(typeof client.update,'function');
  await assert.rejects(client.update(owner,input),error=>error instanceof ApplicationClientError&&error.code===code);
 }
});
