import assert from 'node:assert/strict';import {test} from 'node:test';
import {createApplicationsClient,ApplicationClientError} from '../src/lib/client-applications.ts';
const owner='11111111-1111-4111-8111-111111111111',id='22222222-2222-4222-8222-222222222222',stamp='2026-10-25T10:00:00.123456Z';
const row={id,revision:'1',view:'applicant',target:{id:owner,kind:'workRequest',title:'Ремонт'},specialistId:owner,
 snapshot:{name:'Анна',profession:'Сантехник',price:'1500.00',skills:'О себе',about:'О'.repeat(3000),phone:null,email:'fixture@example.invalid',messengerUrl:null},
 message:'',status:'pending_payment',paid:false,sentAt:null,createdAt:stamp,updatedAt:stamp};
test('new application about text roundtrips fully with its own bound without weakening legacy skills bound',async()=>{
 assert.deepEqual(await createApplicationsClient(async()=>Response.json(row)).read(owner,id),row);
 for(const snapshot of [{...row.snapshot,about:'a'.repeat(3001)},{...row.snapshot,about:'bad\u0000'},{...row.snapshot,skills:'x'.repeat(501)}])await assert.rejects(createApplicationsClient(async()=>Response.json({...row,snapshot})).read(owner,id),ApplicationClientError);
});
