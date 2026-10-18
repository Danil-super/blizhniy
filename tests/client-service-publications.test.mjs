import assert from 'node:assert/strict';import {test} from 'node:test';
import {createServicePublicationClient,createServiceModerationClient,parseServicePublicationSnapshot,ServiceClientError} from '../src/lib/client-service-publications.ts';
import {parseServicePublicationForm} from '../src/lib/service-publication-contract.ts';
const owner='10000000-0000-4000-8000-000000000001',id='10000000-0000-4000-8000-000000000002',key='10000000-0000-4000-8000-000000000003',stamp='2026-10-18T00:00:00.123456Z';
const snapshot=kind=>({id,kind,form:parseServicePublicationForm(kind,{title:'Технический материал'}),photos:[],revision:'9007199254740993',status:'draft',paid:false,createdAt:stamp,updatedAt:stamp,publishedAt:null,expiresAt:null});
test('service client validates complete returned forms, exact revisions and photo identities before displaying private data',()=>{
 for(const kind of ['specialist','fair','marquee'])assert.deepEqual(parseServicePublicationSnapshot(snapshot(kind),kind,id),snapshot(kind));
 const row=snapshot('specialist');for(const bad of [{...row,kind:['specialist']},{...row,status:['draft']},{...row,revision:9007199254740993},{...row,paid:'false'},
  {...row,form:{title:'Incomplete reply'}},{...row,photos:[{id:key,mimeType:'image/webp',width:2,height:2,size:12}]},{...row,unexpected:true}])assert.throws(()=>parseServicePublicationSnapshot(bad,'specialist'),ServiceClientError);
});
test('service create/list/intent/update use only bounded cookie requests, one stable intent and decimal CAS without retries',async()=>{
 const calls=[],row=snapshot('fair'),client=createServicePublicationClient(async(path,init)=>{const body=JSON.parse(init.body);calls.push({path,init,body});return Response.json(body.action==='list'?{items:[{id,kind:'fair',title:row.form.title,revision:row.revision,status:'draft',paid:false,updatedAt:stamp}],nextCursor:null}:row);});
 assert.deepEqual(await client.create(owner,'fair',key,row.form),row);assert.deepEqual(await client.intent(owner,'fair',key),row);assert.equal((await client.list(owner,'fair',null)).items.length,1);
 assert.deepEqual(await client.update(owner,'fair',id,row.revision,row.form),row);assert.equal(calls.length,4);
 for(const call of calls){assert.equal(call.path,'/api/account/service-publications');assert.equal(call.init.credentials,'same-origin');assert.equal(call.init.redirect,'error');assert.equal(call.init.headers.Authorization,undefined);assert.equal(call.body.expectedOwnerId,owner);assert.equal(call.body.kind,'fair');}
 assert.equal(calls[0].body.creationKey,key);assert.equal(calls[3].body.expectedRevision,'9007199254740993');
 let writes=0;const broken=createServicePublicationClient(async()=>{writes++;throw Error('Synthetic connection loss');});await assert.rejects(broken.create(owner,'fair',key,row.form),ServiceClientError);assert.equal(writes,1);
});
test('service review client binds owner and moderator to the exact kind and current review without trusting malformed replies',async()=>{
 const review={id:key,revision:'1',state:'pending',note:null},calls=[],client=createServiceModerationClient(async(path,init)=>{calls.push({path,body:JSON.parse(init.body)});return Response.json(review);});
 assert.deepEqual(await client.submit(owner,'marquee',id,'1'),review);assert.deepEqual(await client.read(owner,'marquee',id,'1'),review);
 assert.equal(calls[0].path,'/api/account/service-moderation');assert.deepEqual(calls[0].body,{expectedOwnerId:owner,kind:'marquee',publicationId:id,expectedRevision:'1'});
 const bad=createServiceModerationClient(async()=>Response.json({...review,state:'approved',note:'Hidden invalid note'}));await assert.rejects(bad.read(owner,'fair',id,'1'),ServiceClientError);
 const deny=createServicePublicationClient(async()=>Response.json({error:{code:'PUBLICATION_CHANGED'}},{status:409}));await assert.rejects(deny.read(owner,'fair',id),error=>error.code==='PUBLICATION_CHANGED');
});
test('service clients bound decoded payloads and reject late abort or malformed JSON rather than applying an unknown result',async()=>{
 for(const response of [()=>new Response('x'.repeat(262145)),()=>new Response('{'),()=>new Response(new Uint8Array([0xff]))]){
  const client=createServicePublicationClient(async()=>response());await assert.rejects(client.read(owner,'specialist',id),ServiceClientError);
 }
 const abort=new AbortController();abort.abort();let called=0;const client=createServicePublicationClient(async()=>{called++;return Response.json(snapshot('fair'));});
 await assert.rejects(client.read(owner,'fair',id,{signal:abort.signal}),ServiceClientError);assert.equal(called,0);
});
test('owner review replies remain bound to the requested revision and submit cannot adopt a missing or outdated request',async()=>{
 const base={id:key,revision:'2',state:'pending',note:null};
 const newer=createServiceModerationClient(async()=>Response.json(base));await assert.rejects(newer.read(owner,'fair',id,'1'),ServiceClientError);
 for(const state of ['not_submitted','outdated']){
  const row=state==='not_submitted'?{id:null,revision:null,state,note:null}:{...base,revision:'1',state};
  const client=createServiceModerationClient(async()=>Response.json(row));await assert.rejects(client.submit(owner,'fair',id,'1'),ServiceClientError);
 }
});
