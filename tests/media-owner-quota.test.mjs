import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {test} from 'node:test';
import {loadMediaModule} from './media-module.mjs';
import * as contract from '../src/lib/media-upload-contract.ts';
import {createListingMediaClient} from '../src/lib/client-listing-media.ts';
import {createProductionMediaHandler} from '../src/lib/production-media-http.ts';
const owner='11111111-1111-4111-8111-111111111111',token='a'.repeat(64),origin='https://example.invalid';
const image={mimeType:'image/webp',width:16,height:9,size:128,sha256:'b'.repeat(64)};
const {MediaMetadataRepository}=loadMediaModule('media-metadata');
function fixture({isolation='read committed',inserted=true,existing=null}={}){
 const calls=[];const row={...image,id:randomUUID(),state:'pending'};
 const db={transaction:work=>work({query:async(sql,values)=>{
  calls.push({sql,values});
  if(sql.startsWith('select u.id'))return{rows:[{id:owner,role:'user',isBlocked:false,verified:true,authVersion:'0'}]};
  if(sql.startsWith('select token_hash')||sql.startsWith('update app.sessions'))return{rowCount:1,rows:[]};
  if(sql.startsWith('select current_setting'))return{rows:[{isolation}]};
  if(sql.startsWith('insert'))return{rowCount:inserted?1:0,rows:inserted?[row]:[]};
  return{rowCount:existing?1:0,rows:existing?[existing]:[]};
 }})};return{repo:new MediaMetadataRepository(db,{read:()=>assert.fail('Reservation must not touch files')}),calls,row};
}
test('approved media owner quota is 250MiB and500 stored or pending objects',()=>{
 assert.equal(contract.mediaOwnerByteLimit,250*1024*1024);assert.equal(contract.mediaOwnerObjectLimit,500);assert.match(contract.mediaOwnerQuotaText,/500/);assert.match(contract.mediaOwnerQuotaText,/250/);
});
test('quota admission happens inside the authenticated owner transaction with bounded aggregate values',async()=>{
 const f=fixture(),result=await f.repo.reserve(token,randomUUID(),image);assert.equal(result.id,f.row.id);
 const insert=f.calls.find(call=>call.sql.startsWith('insert'));assert.equal(insert.values[0],owner);assert.equal(insert.values[7],500);assert.equal(insert.values[8],250*1024*1024);
 assert.match(insert.sql,/count\(\*\)/i);assert.match(insert.sql,/sum\(size\)/i);assert.match(insert.sql,/owner_id=\$1/);
 assert.ok(f.calls.findIndex(call=>call.sql.startsWith('select token_hash'))<f.calls.indexOf(insert));
});
test('owner quota failures preserve ready replay and pending/conflict outcomes without new reservations',async()=>{
 const ready={...image,id:randomUUID(),state:'ready'};const f=fixture({inserted:false,existing:ready});assert.deepEqual(await f.repo.reserve(token,randomUUID(),image),ready);
 for(const [existing,code] of [[null,'MEDIA_OWNER_QUOTA_EXCEEDED'],[{...ready,state:'pending'},'MEDIA_IN_PROGRESS'],[{...ready,sha256:'c'.repeat(64)},'MEDIA_INTENT_CONFLICT']]){
  const current=fixture({inserted:false,existing});await assert.rejects(current.repo.reserve(token,randomUUID(),image),error=>error.code===code);assert.equal(current.calls.filter(call=>call.sql.startsWith('insert')).length,1);
 }
});
test('repeatable read snapshots cannot bypass the owner quota',async()=>{
 for(const isolation of ['repeatable read','serializable',undefined]){
  const f=fixture({isolation:isolation??'unknown'});await assert.rejects(f.repo.reserve(token,randomUUID(),image),error=>error.code==='MEDIA_METADATA_UNAVAILABLE');assert.equal(f.calls.some(call=>call.sql.startsWith('insert')),false);
 }
});
test('HTTP and browser preserve an explicit owner quota result without retrying the upload',async()=>{
 const id=randomUUID(),handle=createProductionMediaHandler({origin},()=>({limiter:{allowProduction:async()=>true},identity:{resolveSession:async()=>({id:owner})},upload:{upload:async()=>{throw Object.assign(Error('private diagnostic'),{code:'MEDIA_OWNER_QUOTA_EXCEEDED'});}}}),()=>{});
 const response=await handle(new Request(origin+'/api/account/media',{method:'POST',headers:{host:'example.invalid',origin,'content-type':'image/png','x-blizhniy-request':'1','x-real-ip':'192.0.2.1','x-blizhniy-owner':owner,'x-blizhniy-intent':id,cookie:'__Host-blizhniy_session='+token},body:new Uint8Array([1])}),'upload');
 assert.equal(response.status,409);assert.deepEqual(await response.json(),{error:{code:'MEDIA_OWNER_QUOTA_EXCEEDED'}});assert.equal(response.headers.get('cache-control'),'no-store');
 let calls=0;const client=createListingMediaClient(async()=>{calls++;return Response.json({error:{code:'MEDIA_OWNER_QUOTA_EXCEEDED'}},{status:409});});
 await assert.rejects(client.upload(owner,id,new Blob(['x'],{type:'image/png'})),error=>error.code==='MEDIA_OWNER_QUOTA_EXCEEDED'&&error.message.includes('250')&&error.message.includes('500')&&!error.message.includes('private'));assert.equal(calls,1);
});
