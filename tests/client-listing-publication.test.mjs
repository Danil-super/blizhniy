import assert from 'node:assert/strict';import {test} from 'node:test';
import {inspectListingPublication,parseListingPublicationCheck} from '../src/lib/client-listing-publication.ts';
const owner='11111111-1111-4111-8111-111111111111',id='22222222-2222-4222-8222-222222222222',revision='9007199254740993';
const report={listingId:id,revision,checksPassed:true,issues:[],tariff:{id:'listing-standard',name:'Объявление',amount:'199.99',currency:'RUB',durationDays:30}};
test('publication check client uses cookie-only exact three-field request with no retries',async()=>{
 const fetch=globalThis.fetch;let calls=0;
 try{globalThis.fetch=async(url,options)=>{calls++;assert.equal(url,'/api/account/listing-publication');assert.equal(options.credentials,'same-origin');assert.equal(options.method,'POST');assert.equal(options.headers.Authorization,undefined);
  assert.deepEqual(JSON.parse(options.body),{expectedOwnerId:owner,listingId:id,expectedRevision:revision});return Response.json(report);};
  assert.deepEqual(await inspectListingPublication(owner,id,revision),report);assert.equal(calls,1);
  globalThis.fetch=async()=>{calls++;throw Error('network');};await assert.rejects(inspectListingPublication(owner,id,revision));assert.equal(calls,2);
 }finally{globalThis.fetch=fetch;}
});
test('publication check parser rejects wrong identity/revision, inconsistent success, numeric money and oversized or privileged replies',()=>{
 for(const value of [{...report,listingId:owner},{...report,revision:'1'},{...report,paid:true},{...report,tariff:{...report.tariff,amount:199.99}},
  {...report,checksPassed:true,issues:[{field:'contact',message:'Исправьте телефон'}]},{...report,tariff:null},
  {...report,checksPassed:false,issues:[{field:'owner',message:'private'}]},{...report,tariff:{...report.tariff,name:'x'.repeat(201)}}])assert.throws(()=>parseListingPublicationCheck(value,id,revision));
 assert.deepEqual(parseListingPublicationCheck(report,id,revision),report);
});
test('publication check bounds streaming replies and cancels oversized bodies instead of accepting unbounded server data',async()=>{
 const fetch=globalThis.fetch;let cancelled=false;
 try{globalThis.fetch=async()=>new Response(new ReadableStream({start(controller){controller.enqueue(new Uint8Array(16385));},cancel(){cancelled=true;}}));
  await assert.rejects(inspectListingPublication(owner,id,revision));assert.equal(cancelled,true);
 }finally{globalThis.fetch=fetch;}
});
