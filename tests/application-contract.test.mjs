import assert from 'node:assert/strict';import {test} from 'node:test';
import {parseApplicationCreate,parseApplicationEdit,ApplicationInputError} from '../src/lib/application-contract.ts';
const id='10000000-0000-4000-8000-000000000001',other='10000000-0000-4000-8000-000000000002';
const core={message:'  Готов помочь.\nЕсть опыт.  ',expectedTargetRevision:'9007199254740993',specialistId:other,expectedSpecialistRevision:'1'};
const create={...core,kind:'vacancy',targetId:id,creationKey:other};
test('application input binds one stable intent to exact target and specialist revisions without client-claimed snapshots or payment',()=>{
 assert.deepEqual(parseApplicationCreate(create),{...create,message:'Готов помочь.\nЕсть опыт.'});
 assert.equal(parseApplicationCreate({...create,kind:'workRequest',message:''}).kind,'workRequest');
 for(const input of [{...create,paid:true},{...create,status:'sent'},{...create,snapshot:{phone:'forged'}},{...create,applicantId:id},{...create,expectedTargetRevision:9007199254740993},
  {...create,specialistId:null},{...create,creationKey:'invalid'},{...create,kind:'specialist'},Object.assign(Object.create({}),create)])assert.throws(()=>parseApplicationCreate(input),ApplicationInputError);
});
test('application edit has a separate complete CAS contract and cannot replace the original target, applicant or intent',()=>{
 const edit={...core,applicationId:id,expectedRevision:'2'};assert.deepEqual(parseApplicationEdit(edit),{...edit,message:core.message.trim()});
 for(const input of [{...edit,targetId:other},{...edit,creationKey:other},{...edit,expectedRevision:'0'},{...edit,expectedSpecialistRevision:'9223372036854775808'}])assert.throws(()=>parseApplicationEdit(input),ApplicationInputError);
});
test('application message is optional in meaning but required in the envelope, bounded, Unicode-safe and permits ordinary multiline text',()=>{
 assert.equal(parseApplicationCreate({...create,message:'x'.repeat(3000)}).message.length,3000);
 for(const message of [null,1,{},'x'.repeat(3001),'\u0000','\ud800'])assert.throws(()=>parseApplicationCreate({...create,message}),ApplicationInputError);
 const missing={...create};delete missing.message;assert.throws(()=>parseApplicationCreate(missing),ApplicationInputError);
});
