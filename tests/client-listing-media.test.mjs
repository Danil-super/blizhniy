import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createListingMediaClient} from '../src/lib/client-listing-media.ts';
const owner='11111111-1111-4111-8111-111111111111',id='22222222-2222-4222-8222-222222222222';
const image={id,mimeType:'image/webp',width:40,height:80,size:12};
test('media browser sends raw bytes, cookie authority and stable intent; association carries exact CAS without retry',async()=>{
 const calls=[],api=createListingMediaClient(async(url,options)=>{
  calls.push({url,options});return Response.json(url==='/api/account/media'?image:{id,revision:'9007199254740993',photos:[image]});
 });
 const file=new Blob(['synthetic'],{type:'image/jpeg'});
 assert.deepEqual(await api.upload(owner,id,file),image);
 assert.deepEqual((await api.photos(owner,id)).photos,[image]);
 assert.equal((await api.replace(owner,id,'9007199254740992',[id])).revision,'9007199254740993');
 for(const {options} of calls){assert.equal(options.credentials,'same-origin');assert.equal(options.redirect,'error');assert.equal(options.cache,'no-store');assert.equal(options.headers.Authorization,undefined);}
 assert.equal(calls[0].options.body,file);assert.equal(calls[0].options.headers['X-Blizhniy-Intent'],id);
 assert.equal(JSON.parse(calls[2].options.body).expectedRevision,'9007199254740992');assert.equal(calls.length,3);
});
test('media browser rejects private server fields, bad IDs and oversized replies; unknown outcomes are never retried',async()=>{
 for(const result of [{...image,path:'/private'},{...image,width:0},{...image,id:owner+'bad'}]){
  let calls=0;const api=createListingMediaClient(async()=>{calls++;return Response.json(result);});
  await assert.rejects(api.upload(owner,id,new Blob(['x'],{type:'image/png'})));assert.equal(calls,1);
 }
 let calls=0;const api=createListingMediaClient(async()=>{calls++;throw new Error('synthetic-private-cause');});
 await assert.rejects(api.replace(owner,id,'1',[id]),e=>e.code==='UNKNOWN'&&!e.message.includes('synthetic-private'));assert.equal(calls,1);
 const invalid=createListingMediaClient(async()=>assert.fail('invalid request sent'));
 await assert.rejects(invalid.upload(owner,id,new Blob(['x'],{type:'text/html'})));
 await assert.rejects(invalid.replace(owner,id,'1',[id,id]));
});
test('private image reads use POST and enforce type, bounded bytes, abort and non-public transport',async()=>{
 let request;const api=createListingMediaClient(async(url,options)=>{request={url,options};return new Response(new Uint8Array(12),{headers:{'Content-Type':'image/webp'}});});
 assert.equal((await api.read(owner,id)).size,12);assert.equal(request.url,'/api/account/media/read');assert.equal(request.options.method,'POST');
 assert.deepEqual(JSON.parse(request.options.body),{expectedOwnerId:owner,fileId:id});
 for(const response of [new Response('html',{headers:{'Content-Type':'text/html'}}),new Response(new Uint8Array(2097153),{headers:{'Content-Type':'image/webp'}})])
  await assert.rejects(createListingMediaClient(async()=>response).read(owner,id));
 const controller=new AbortController();controller.abort();
 await assert.rejects(createListingMediaClient(async()=>assert.fail('aborted fetch')).read(owner,id,{signal:controller.signal}));
});

test('a busy first upload can be edited, while a retry after an uncertain upload keeps its original intent',async()=>{
 const file=new Blob(['photo'],{type:'image/png'});
 for(const code of ['MEDIA_BUSY','MEDIA_UNAVAILABLE','MEDIA_IN_PROGRESS','INVALID_IMAGE','MEDIA_OWNER_QUOTA_EXCEEDED']){
  const status={MEDIA_BUSY:503,MEDIA_UNAVAILABLE:503,MEDIA_IN_PROGRESS:409,INVALID_IMAGE:422,MEDIA_OWNER_QUOTA_EXCEEDED:409}[code];
  const api=createListingMediaClient(async()=>Response.json({error:{code}},{status}));
  await assert.rejects(api.upload(owner,id,file),error=>{
   const rejected=code==='INVALID_IMAGE'||code==='MEDIA_OWNER_QUOTA_EXCEEDED';
   assert.equal(error.allowsDraftEdit(true),rejected||code==='MEDIA_BUSY');
   assert.equal(error.allowsDraftEdit(false),rejected);
   if(code==='MEDIA_UNAVAILABLE')assert.match(error.draftMessage,/повторите сохранение/i);
   return true;
  });
 }
});
