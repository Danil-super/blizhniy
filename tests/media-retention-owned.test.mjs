import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {test} from 'node:test';
import {loadMediaModule} from './media-module.mjs';
const {MediaMetadataRepository}=loadMediaModule('media-metadata'),token='a'.repeat(64);
const record={id:randomUUID(),mimeType:'image/webp',width:16,height:9,size:128,sha256:'a'.repeat(64),state:'ready'};
function fixture({terminal=true,isolation='read committed'}={}){
 let reads=0;const calls=[];
 const db={transaction:work=>work({query:async(sql,values)=>{
  calls.push({sql,values});if(sql.startsWith('select u.id'))return{rows:[{id:randomUUID(),role:'user',isBlocked:false,verified:true,authVersion:'0'}]};
  if(sql.startsWith('select token_hash')||sql.startsWith('update app.sessions'))return{rowCount:1,rows:[]};
  if(sql.startsWith('select current_setting'))return{rows:[{isolation}]};
  if(sql.includes('app.media_retirement_requests'))return{rows:[{terminal}],rowCount:terminal?1:0};
  if(sql.startsWith('insert'))return{rows:[],rowCount:0};return{rows:[record],rowCount:1};
 }})};
 return{repo:new MediaMetadataRepository(db,{read:async()=>{reads++;return Buffer.alloc(128);}},true),calls,reads:()=>reads};
}
test('terminal owner media cannot be replayed, claimed or completed and never reaches files',async()=>{
 const app=fixture(),metadata={...record};delete metadata.id;delete metadata.state;
 for(const operation of [()=>app.repo.getByIntent(token,randomUUID()),()=>app.repo.reserve(token,randomUUID(),metadata),()=>app.repo.claimWrite(token,record.id,metadata),()=>app.repo.complete(token,record.id)])
  await assert.rejects(operation(),{code:'MEDIA_INTENT_CONFLICT'});
 assert.equal(await app.repo.readOwned(token,record.id),null);assert.equal(await app.repo.getWriteAttempt(token,record.id),null);assert.equal(app.reads(),0);
});
test('retention-aware owner reads enforce fresh isolation before accessing media or files',async()=>{
 for(const isolation of ['repeatable read','serializable']){
  const app=fixture({terminal:false,isolation});
  for(const operation of [()=>app.repo.readOwned(token,record.id),()=>app.repo.getByIntent(token,randomUUID()),()=>app.repo.getWriteAttempt(token,record.id),()=>app.repo.complete(token,record.id)])await assert.rejects(operation(),{code:'MEDIA_METADATA_UNAVAILABLE'});
  assert.equal(app.reads(),0);assert.equal(app.calls.some(row=>row.sql.includes('from app.media_objects')),false);
 }
});
test('retention lookup takes a media lock before its separate terminal check and file read',async()=>{
 const app=fixture({terminal:false});assert.ok(await app.repo.readOwned(token,record.id));
 const lookup=app.calls.findIndex(row=>row.sql.includes('from app.media_objects')),check=app.calls.findIndex(row=>row.sql.includes('app.media_retirement_requests'));
 assert.ok(lookup>=0&&check>lookup);assert.match(app.calls[lookup].sql,/for update/);assert.equal(app.reads(),1);
});
