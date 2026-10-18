import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createWorkPublicationClient,parseWorkPublicationSnapshot} from '../src/lib/client-work-publications.ts';
import {parseWorkPublicationForm} from '../src/lib/work-publication-contract.ts';
const owner='11111111-1111-4111-8111-111111111111',id='22222222-2222-4222-8222-222222222222',key='33333333-3333-4333-8333-333333333333';
const form=parseWorkPublicationForm('workRequest',{title:'Synthetic',budget:'12.1'});
const snapshot={id,kind:'workRequest',revision:'9007199254740993',status:'draft',paid:false,form,photos:[],
 createdAt:'2026-10-18T00:00:00.000001Z',updatedAt:'2026-10-18T00:00:00.000002Z',publishedAt:null,expiresAt:null};
test('work client validates complete canonical snapshots, owner-private photo correspondence and exact bigint revisions',()=>{
 assert.deepEqual(parseWorkPublicationSnapshot(snapshot,'workRequest',id),snapshot);
 for(const value of [{...snapshot,id:owner},{...snapshot,kind:'vacancy'},{...snapshot,revision:9007199254740992},
  {...snapshot,revision:'01'},{...snapshot,paid:'false'},{...snapshot,status:'arbitrary'},{...snapshot,createdAt:'bad'},
  {...snapshot,updatedAt:'2026-10-18T00:00:00.000Z'},{...snapshot,photos:[{id}]},{...snapshot,token:'synthetic'},
  {...snapshot,form:{...form,paid:true}},{...snapshot,form:{...form,photoIds:[key]}}])assert.throws(()=>parseWorkPublicationSnapshot(value,'workRequest',id));
 for(const value of [{...snapshot,status:['draft']},{...snapshot,form:{kind:'workRequest',title:'Partial reply'}}])assert.throws(()=>parseWorkPublicationSnapshot(value,'workRequest',id));
});
test('work client dispatches only bounded same-origin cookie requests and exact action envelopes',async()=>{
 const calls=[],client=createWorkPublicationClient(async(path,init)=>{calls.push({path,init,body:JSON.parse(init.body)});
  const action=JSON.parse(init.body).action;return Response.json(action==='list'?{items:[],nextCursor:null}:snapshot);});
 assert.deepEqual(await client.create(owner,'workRequest',key,form),snapshot);
 assert.deepEqual(await client.read(owner,'workRequest',id),snapshot);
 assert.deepEqual(await client.intent(owner,'workRequest',key),snapshot);
 assert.deepEqual(await client.update(owner,'workRequest',id,snapshot.revision,form),snapshot);
 assert.deepEqual(await client.list(owner,'workRequest',null),{items:[],nextCursor:null});
 assert.deepEqual(calls.map(c=>c.body.action),['create','read','intent','update','list']);
 assert.deepEqual(calls[0].body,{action:'create',expectedOwnerId:owner,kind:'workRequest',creationKey:key,form});
 assert.deepEqual(calls[3].body,{action:'update',expectedOwnerId:owner,kind:'workRequest',publicationId:id,expectedRevision:snapshot.revision,form});
 for(const c of calls){assert.equal(c.path,'/api/account/work-publications');assert.equal(c.init.credentials,'same-origin');
  assert.equal(c.init.redirect,'error');assert.equal(c.init.cache,'no-store');assert.ok(c.init.signal instanceof AbortSignal);
  assert.equal(c.init.headers['X-Blizhniy-Request'],'1');assert.equal(Object.hasOwn(c.init.headers,'Authorization'),false);
  assert.equal(c.init.method,['create','update'].includes(c.body.action)?'PUT':'POST');}
});
test('work intent can return null and lists retain microseconds without leaking bulk contacts',async()=>{
 const cursor={id,updatedAt:snapshot.updatedAt},summary={id,kind:'workRequest',revision:snapshot.revision,title:form.title,status:'draft',paid:false,updatedAt:snapshot.updatedAt};
 const client=createWorkPublicationClient(async(_path,init)=>Response.json(JSON.parse(init.body).action==='intent'?null:{items:[summary],nextCursor:cursor}));
 assert.equal(await client.intent(owner,'workRequest',key),null);assert.deepEqual(await client.list(owner,'workRequest',cursor),{items:[summary],nextCursor:cursor});
 const bad=createWorkPublicationClient(async()=>Response.json({items:[{...summary,email:'synthetic@example.invalid'}],nextCursor:null}));
 await assert.rejects(()=>bad.list(owner,'workRequest',null),{code:'UNKNOWN'});
});
test('work client errors are status-paired, generic and never retry uncertain mutations',async()=>{
 for(const [status,code,expected] of [[401,'UNAUTHENTICATED','UNAUTHENTICATED'],[409,'PUBLICATION_CHANGED','PUBLICATION_CHANGED'],
  [404,'PUBLICATION_NOT_FOUND','PUBLICATION_NOT_FOUND'],[429,'RATE_LIMITED','RATE_LIMITED'],[422,'INVALID_INPUT','INVALID_INPUT'],
  [503,'Synthetic private SQL secret','UNKNOWN'],[200,'INVALID_INPUT','UNKNOWN'],[503,'UNAUTHENTICATED','UNKNOWN']]){
  let calls=0;const client=createWorkPublicationClient(async()=>{calls++;return Response.json({error:{code}},{status});});
  await assert.rejects(()=>client.create(owner,'workRequest',key,form),error=>error.code===expected&&!error.message.includes('SQL'));assert.equal(calls,1);
 }
 for(const reply of [()=>{throw Error('Synthetic private transport secret');},()=>new Response('not JSON'),()=>new Response(' '.repeat(2097153))]){
  let calls=0;const client=createWorkPublicationClient(async()=>{calls++;return reply();});
  await assert.rejects(()=>client.update(owner,'workRequest',id,snapshot.revision,form),{code:'UNKNOWN'});assert.equal(calls,1);
 }
});
test('work client rejects malformed authority and cancelled requests before transport',async()=>{
 let calls=0;const client=createWorkPublicationClient(async()=>{calls++;return Response.json(snapshot);}),controller=new AbortController();controller.abort();
 await assert.rejects(()=>client.read('bad','workRequest',id));await assert.rejects(()=>client.create(owner,'specialist',key,form));
 await assert.rejects(()=>client.update(owner,'workRequest',id,1,form));await assert.rejects(()=>client.read(owner,'workRequest',id,{signal:controller.signal}));
 assert.equal(calls,0);
});
