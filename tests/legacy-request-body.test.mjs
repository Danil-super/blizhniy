import assert from 'node:assert/strict';import test from 'node:test';
import {readLegacyJson,readLegacyProfileText,readLegacyFormData} from '../src/lib/legacy-request-body.ts';
const request=(body,headers={})=>new Request('https://example.invalid/api/legacy',{method:'POST',headers,body,...(body instanceof ReadableStream?{duplex:'half'}:{})});
test('legacy JSON bounds actual input independently of declared length and preserves valid payloads',async()=>{
 assert.deepEqual(await readLegacyJson(request('{"description":"Работа"}')),{description:'Работа'});
 for(const headers of [{},{'content-length':'1'},{'content-length':String(1024*1024)}])await assert.rejects(readLegacyJson(request(JSON.stringify({description:'x'.repeat(600000)}),headers)),{status:413});
 await assert.rejects(readLegacyJson(request('{malformed')), {status:400});
 assert.deepEqual(await readLegacyJson(request('{}')),{});
});
test('profile preserves existing400000-byte avatar and500000-code-unit UTF8 envelope',async()=>{
 const avatar=JSON.stringify({profile:{avatarDataUrl:'data:image/webp;base64,'+'a'.repeat(400000)}});
 assert.equal(await readLegacyProfileText(request(avatar)),avatar);
 const unicode='я'.repeat(499990);assert.equal(await readLegacyProfileText(request(unicode)),unicode);
 await assert.rejects(readLegacyProfileText(request('x'.repeat(1500001))),{status:413});
});
test('multipart parsing retains folder, ten files, names and bytes',async()=>{
 const form=new FormData();form.set('folder','listings');for(let i=0;i<10;i++)form.append('files',new File(['synthetic-image-'+i],`photo-${i}.webp`,{type:'image/webp'}));
 const parsed=await readLegacyFormData(request(form));assert.equal(parsed.get('folder'),'listings');
 const files=parsed.getAll('files');assert.equal(files.length,10);for(let i=0;i<10;i++){assert.equal(files[i].name,`photo-${i}.webp`);assert.equal(await files[i].text(),'synthetic-image-'+i);}
 await assert.rejects(readLegacyFormData(request('',{'content-length':String(102*1024*1024)})),{status:413});
});
test('multipart uses one ingestion slot, bounded deadline, and nonblocking cancellation; slot recovers',async()=>{
 const first=readLegacyFormData(request(new ReadableStream({pull(){return new Promise(()=>{});},cancel(){return new Promise(()=>{});}}),{'content-type':'multipart/form-data; boundary=synthetic'}),30);
 await assert.rejects(readLegacyFormData(request(new FormData())), {status:429});
 await assert.rejects(first,{status:408});
 const next=new FormData();next.set('folder','listings');assert.equal((await readLegacyFormData(request(next))).get('folder'),'listings');
});
test('upload rejects URL-encoded field amplification before parsing',async()=>{
 await assert.rejects(readLegacyFormData(request('a=&'.repeat(350000),{'content-type':'application/x-www-form-urlencoded'})),{status:415});
 await assert.rejects(readLegacyFormData(request('{}',{'content-type':'application/json'})),{status:415});
});
test('multipart bounds field and file counts, field bytes and names; each rejection releases admission',async()=>{
 for(const make of [
  ()=>{const f=new FormData();for(let i=0;i<5000;i++)f.append('a','');return f;},
  ()=>{const f=new FormData();f.set('folder','x'.repeat(65537));return f;},
  ()=>{const f=new FormData();f.set('x'.repeat(101),'value');return f;},
  ()=>{const f=new FormData();for(let i=0;i<11;i++)f.append('files',new File(['x'],i+'.webp'));return f;},
 ]){
  await assert.rejects(readLegacyFormData(request(make())),{status:413});
  const f=new FormData();f.set('folder','listings');assert.equal((await readLegacyFormData(request(f))).get('folder'),'listings');
 }
});
test('multipart accepts exact ten MiB file boundary and rejects one extra byte',async()=>{
 const bytes=new Uint8Array(10*1024*1024);bytes[0]=19;bytes[bytes.length-1]=93;
 const valid=new FormData();valid.append('files',new File([bytes],'exact.webp',{type:'image/webp'}));
 const file=(await readLegacyFormData(request(valid))).get('files');assert.equal(file.size,bytes.length);
 const saved=new Uint8Array(await file.arrayBuffer());assert.equal(saved[0],19);assert.equal(saved[saved.length-1],93);
 const oversized=new FormData();oversized.append('files',new File([bytes,new Uint8Array(1)],'large.webp'));
 await assert.rejects(readLegacyFormData(request(oversized)),{status:413});
});
test('multipart rejects malformed or absent boundaries and recovers',async()=>{
 for(const type of ['multipart/form-data','multipart/form-data; boundary=synthetic'])await assert.rejects(readLegacyFormData(request('broken',{ 'content-type':type})),{status:type==='multipart/form-data'?415:400});
 const form=new FormData();form.set('folder','listings');assert.equal((await readLegacyFormData(request(form))).get('folder'),'listings');
});
test('field amplification fails safely in a child process with a 128MiB heap',async()=>{
 const {spawnSync}=await import('node:child_process');
 const moduleURL=new URL('../src/lib/legacy-request-body.ts',import.meta.url).href;
 const code=`import {readLegacyFormData} from ${JSON.stringify(moduleURL)};
 const url='https://example.invalid';
 const body='a=&'.repeat(4000000);
 try {await readLegacyFormData(new Request(url,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body}));process.exitCode=2;}
 catch(e){if(e.status!==415)throw e;}
 const part='--synthetic\\r\\nContent-Disposition: form-data; name="a"\\r\\n\\r\\n\\r\\n';
 const payload=part.repeat(100000)+'--synthetic--\\r\\n';
 try {await readLegacyFormData(new Request(url,{method:'POST',headers:{'content-type':'multipart/form-data; boundary=synthetic'},body:payload}));process.exitCode=3;}
 catch(e){if(e.status!==413)throw e;}`;
 const result=spawnSync(process.execPath,['--max-old-space-size=128','--experimental-strip-types','--input-type=module','-e',code],{timeout:10000,encoding:'utf8',maxBuffer:65536});
 assert.equal(result.error,undefined);assert.equal(result.signal,null);assert.equal(result.status,0,result.stderr);
});
test('endless empty chunks cannot monopolize JSON parser or evade the deadline',async()=>{
 let count=0;const body=new ReadableStream({pull(c){count++;c.enqueue(new Uint8Array());}});
 await assert.rejects(readLegacyJson(request(body)),error=>[408,413].includes(error.status));assert.ok(count<=1027);
 assert.deepEqual(await readLegacyJson(request('{}')),{});
});
test('every affected legacy parser and webhook alias crosses the shared boundary',async()=>{
 const {readFile}=await import('node:fs/promises');
 const paths=['payments/yookassa/webhook','ad-marquee','applications','cabinet/applications','cabinet/bookings','cabinet/listings','cabinet/specialist','cabinet/vacancies','cabinet/work-requests','fair-applications','listings/[listingId]/bookings','listings/draft','listings','payments','vacancies','work-requests','cabinet/profile','uploads/media'];
 for(const path of paths){const source=await readFile(new URL('../src/app/api/'+path+'/route.ts',import.meta.url),'utf8');assert.doesNotMatch(source,/request\.(?:json|text|formData)\(/,path);assert.match(source,/from "@\/lib\/legacy-request-body"/,path);}
 const alias=await readFile(new URL('../src/app/api/webhooks/yookassa/route.ts',import.meta.url),'utf8');assert.match(alias,/payments\/yookassa\/webhook\/route/);
});
