import assert from 'node:assert/strict';import {test} from 'node:test';
import {createNotificationInboxClient,InboxClientError} from '../src/lib/client-notification-inbox.ts';
const owner='10000000-0000-4000-8000-000000000001',id='10000000-0000-4000-8000-000000000002',stamp='2026-10-18T00:00:00.123456Z';
const item={id,category:'system',tone:'info',title:'Событие',message:'Синтетическое уведомление',createdAt:stamp,read:false,actionHref:'/cabinet',bookingRequestId:null};
test('inbox client uses bounded same-origin cookie list and explicit seen-ID marks without bearer or automatic retries',async()=>{
 const calls=[],client=createNotificationInboxClient(async(path,init)=>{const body=JSON.parse(init.body);calls.push({path,init,body});return Response.json(body.action==='list'?{items:[item],nextCursor:null}:{ok:true});});
 assert.deepEqual(await client.list(owner,null),{items:[item],nextCursor:null});await client.mark(owner,'read',[id]);await client.mark(owner,'dismiss',[id]);
 for(const call of calls){assert.equal(call.path,'/api/account/notifications');assert.equal(call.init.credentials,'same-origin');assert.equal(call.init.redirect,'error');assert.equal(call.init.headers.Authorization,undefined);assert.equal(call.body.expectedOwnerId,owner);}
 assert.equal(calls[0].init.method,'POST');assert.deepEqual(calls[1].body.ids,[id]);assert.equal(calls[1].init.method,'PUT');
 let writes=0;const broken=createNotificationInboxClient(async()=>{writes++;throw Error('Synthetic unknown result');});await assert.rejects(broken.mark(owner,'dismiss',[id]),InboxClientError);assert.equal(writes,1);
});
test('inbox client rejects extra private fields, foreign navigation, malformed display content and mismatching pagination',async()=>{
 const badItems=[{...item,userId:owner},{...item,read:'false'},{...item,actionHref:'//foreign.invalid'},{...item,actionHref:'/cabinet?token=private'},
  {...item,actionHref:'/cabinet\n'},{...item,createdAt:'2026-10-18T00:00:00.123Z'},{...item,title:'x'.repeat(201)},{...item,message:'\u0000'},{...item,category:'unknown'},{...item,bookingRequestId:'invalid'}];
 for(const bad of badItems){const client=createNotificationInboxClient(async()=>Response.json({items:[bad],nextCursor:null}));await assert.rejects(client.list(owner,null),InboxClientError);}
 for(const page of [{items:[item,item],nextCursor:null},{items:[item],nextCursor:{id,updatedAt:stamp}},{items:[],nextCursor:null,extra:true}]){
  await assert.rejects(createNotificationInboxClient(async()=>Response.json(page)).list(owner,null),InboxClientError);
 }
 const cursor={id,updatedAt:stamp};await assert.rejects(createNotificationInboxClient(async()=>Response.json({items:[item],nextCursor:null})).list(owner,cursor),InboxClientError);
});
test('inbox client bounds response bytes and chunk counts, rejects invalid UTF8/JSON and respects cancellation',async()=>{
 for(const response of [()=>new Response('x'.repeat(524289)),()=>new Response('{'),()=>new Response(new Uint8Array([0xff]))])await assert.rejects(createNotificationInboxClient(async()=>response()).list(owner,null),InboxClientError);
 const abort=new AbortController();abort.abort();let calls=0;const client=createNotificationInboxClient(async()=>{calls++;return Response.json({items:[],nextCursor:null});});
 await assert.rejects(client.list(owner,null,{signal:abort.signal}),InboxClientError);assert.equal(calls,0);
 let cancelled=false;const chunks=new ReadableStream({pull(controller){controller.enqueue(new Uint8Array([32]));},cancel(){cancelled=true;}});
 await assert.rejects(createNotificationInboxClient(async()=>new Response(chunks)).list(owner,null),InboxClientError);assert.equal(cancelled,true);
});
test('inbox client requires exact successful mutation acknowledgement and classifies only matching server error codes',async()=>{
 for(const value of [{ok:false},{ok:true,extra:true},null])await assert.rejects(createNotificationInboxClient(async()=>Response.json(value)).mark(owner,'read',[id]),InboxClientError);
 for(const [status,code,expected] of [[401,'UNAUTHENTICATED','UNAUTHENTICATED'],[429,'RATE_LIMITED','RATE_LIMITED'],[503,'NOTIFICATIONS_UNAVAILABLE','UNKNOWN'],[500,'UNAUTHENTICATED','UNKNOWN']]){
  await assert.rejects(createNotificationInboxClient(async()=>Response.json({error:{code}},{status})).list(owner,null),error=>error.code===expected);
 }
});
