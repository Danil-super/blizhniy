import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createApplicationsClient,ApplicationClientError} from '../src/lib/client-applications.ts';

const owner='10000000-0000-4000-8000-000000000001',id='10000000-0000-4000-8000-000000000002',stamp='2026-10-26T08:00:00.123456Z';
const saved={id,revision:'7',view:'applicant',target:{id:owner,kind:'vacancy',title:'Синтетическая вакансия'},specialistId:owner,
 snapshot:{name:'Анна',profession:'Сантехник',price:'1500.00',skills:'Ремонт',phone:null,email:null,messengerUrl:null},
 message:'Могу выполнить работу.',status:'pending_payment',paid:false,sentAt:null,createdAt:stamp,updatedAt:stamp,withdrawn:true};
test('withdraw sends exact cookie PUT and preserves the unchanged application revision',async()=>{
 const calls=[],client=createApplicationsClient(async(path,init)=>{calls.push({path,init});return Response.json(saved);});
 assert.deepEqual(await client.withdraw(owner,id,'7'),saved);assert.equal(calls.length,1);assert.equal(calls[0].init.method,'PUT');
 assert.equal(calls[0].init.credentials,'same-origin');assert.deepEqual(JSON.parse(calls[0].init.body),{action:'withdraw',expectedOwnerId:owner,applicationId:id,expectedRevision:'7'});
});
test('withdraw rejects invalid identities, marker, revision and financial acknowledgements',async()=>{
 for(const invalid of [{...saved,id:owner},{...saved,withdrawn:false},{...saved,withdrawn:'yes'},{...saved,revision:'8'},{...saved,paid:true},{...saved,sentAt:stamp},{...saved,view:'recipient'},{...saved,status:'sent',paid:true,sentAt:stamp}]){
  await assert.rejects(createApplicationsClient(async()=>Response.json(invalid)).withdraw(owner,id,'7'),ApplicationClientError);
 }
});
test('lost withdrawal acknowledgement never causes automatic replay or deletion',async()=>{
 let calls=0;await assert.rejects(createApplicationsClient(async()=>{calls++;throw Error('Lost acknowledgement');}).withdraw(owner,id,'7'),ApplicationClientError);assert.equal(calls,1);
});
