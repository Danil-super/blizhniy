import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createHash, randomBytes} from 'node:crypto';
import {createRequire} from 'node:module';
import sharp from 'sharp';
import {normalizeMediaImage} from '../src/lib/media-image.ts';
const {loadLocalPrimaryModule:load}=createRequire(import.meta.url)('../scripts/local-primary-modules.cjs');
const {normalizeProfileAvatar}=load('profile-avatar');
const {ProfileInputError}=load('postgres-profile');
const get=async()=>({normalize:normalizeMediaImage});
const url=(bytes,type)=>`data:${type};base64,${bytes.toString('base64')}`;
const photo=()=>sharp({create:{width:96,height:64,channels:3,background:'#366ead'}});

test('new avatars are fully decoded, oriented and reencoded as bounded metadata-free WebP',async()=>{
 for(const format of ['jpeg','png','webp']){
  const bytes=await photo().withMetadata({orientation:6})[format]().toBuffer();
  const original=Buffer.from(bytes);
  const result=await normalizeProfileAvatar(url(bytes,`image/${format}`),get);
  assert.match(result,/^data:image\/webp;base64,/);
  const output=Buffer.from(result.split(',')[1],'base64');
  const metadata=await sharp(output).metadata();
  assert.equal(metadata.format,'webp');assert.equal(metadata.width,64);assert.equal(metadata.height,96);
  for(const key of ['exif','icc','iptc','xmp','orientation'])assert.equal(metadata[key],undefined);
  assert.ok(output.length<=300*1024);assert.deepEqual(bytes,original);
 }
});
test('signature-only and header-readable truncated avatars are rejected by full pixel decode',async()=>{
 const png=await photo().png().toBuffer();const truncated=png.subarray(0,Math.floor(png.length/2));
 assert.equal((await sharp(truncated).metadata()).width,96);
 for(const [input,type] of [[Buffer.from([255,216,255,0]),'image/jpeg'],[truncated,'image/png'],[Buffer.from('RIFF\x04\0\0\0WEBP'),'image/webp']]){
  await assert.rejects(normalizeProfileAvatar(url(input,type),get),ProfileInputError);
 }
});
test('MIME mismatch, SVG and animated WebP never reach stored output',async()=>{
 const png=await photo().png().toBuffer();
 await assert.rejects(normalizeProfileAvatar(url(png,'image/jpeg'),get),ProfileInputError);
 let calls=0;const unused=async()=>{calls++;return get();};
 await assert.rejects(normalizeProfileAvatar(url(Buffer.from('<svg/>'),'image/svg+xml'),unused),ProfileInputError);
 assert.equal(calls,0);
 const animated=await sharp(Buffer.from([...Array(12).fill(255),...Array(12).fill(0)]),{raw:{width:2,height:4,channels:3,pageHeight:2}}).webp({loop:0,delay:[30,40]}).toBuffer();
 assert.equal((await sharp(animated).metadata()).pages,2);
 await assert.rejects(normalizeProfileAvatar(url(animated,'image/webp'),get),ProfileInputError);
});
test('noncanonical/empty/oversized input is refused before decoder construction',async()=>{
 let calls=0;const unused=async()=>{calls++;return get();};
 for(const value of ['',null,{},'data:image/png;base64,AAAA=',url(Buffer.alloc(300*1024+1),'image/png'),'https://example.invalid/avatar.png']){
  await assert.rejects(normalizeProfileAvatar(value,unused),ProfileInputError);
 }
 assert.equal(calls,0);
});
test('decoder outage, busy, malformed reply and abort fail closed with no sensitive error cause',async()=>{
 const avatar=url(await photo().png().toBuffer(),'image/png');
 for(const code of ['MEDIA_UNAVAILABLE','MEDIA_BUSY']){
  await assert.rejects(normalizeProfileAvatar(avatar,async()=>({normalize:async()=>{throw Object.assign(new Error('synthetic-private-source'),{code});}})),error=>error.message==='Avatar processing unavailable'&&error.cause===undefined);
 }
 const bytes=await photo().webp().toBuffer();const good={bytes,mimeType:'image/webp',size:bytes.length,width:96,height:64,sha256:createHash('sha256').update(bytes).digest('hex')};
 for(const bad of [{...good,sha256:'0'.repeat(64)},{...good,width:9999},{...good,mimeType:'image/png'},{...good,bytes:undefined}]){
  await assert.rejects(normalizeProfileAvatar(avatar,async()=>({normalize:async()=>bad})),{message:'Avatar processing unavailable'});
 }
 const abort=new AbortController();abort.abort(new Error('synthetic-private-source'));let called=false;
 await assert.rejects(normalizeProfileAvatar(avatar,async()=>{called=true;return get();},abort.signal),{message:'Avatar processing unavailable'});assert.equal(called,false);
 const late=new AbortController();
 await assert.rejects(normalizeProfileAvatar(avatar,async()=>({normalize:async()=>{late.abort();return good;}}),late.signal),{message:'Avatar processing unavailable'});
});
test('output must fit the existing profile byte budget; no raw input fallback',async()=>{
 const avatar=url(await photo().png().toBuffer(),'image/png');
 await assert.rejects(normalizeProfileAvatar(avatar,async()=>({normalize:async()=>({bytes:randomBytes(300*1024+1),mimeType:'image/webp'})})),ProfileInputError);
});
