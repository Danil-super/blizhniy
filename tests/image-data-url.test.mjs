import assert from 'node:assert/strict';
import {test} from 'node:test';
import {imageDataUrlToBlob,croppedPhotoFile} from '../src/lib/image-data-url.ts';

test('image conversion decodes bytes and MIME locally without any fetch',async()=>{
 const before=globalThis.fetch;let requests=0;globalThis.fetch=()=>{requests++;throw Error('No network');};
 try{for(const type of ['png','jpeg','webp']){
  const blob=imageDataUrlToBlob(`data:image/${type};base64,AP+A`);
  assert.equal(blob.type,`image/${type}`);assert.deepEqual([...new Uint8Array(await blob.arrayBuffer())],[0,255,128]);
 }assert.equal(requests,0);}finally{globalThis.fetch=before;}
});

test('image conversion rejects URLs, active formats and malformed base64',()=>{
 for(const value of ['https://other.invalid/a.png','blob:synthetic','data:text/html;base64,AAAA','data:image/svg+xml;base64,AAAA','data:image/png,abc','data:image/png;base64,','data:image/png;base64,%%','data:image/png;base64,A'])assert.throws(()=>imageDataUrlToBlob(value));
});

test('cropped photo filenames follow the actual canvas encoder, including its PNG fallback',async()=>{
 for(const format of ['webp','png']){
  const file=croppedPhotoFile(`data:image/${format};base64,AP+A`,'phone.photo.jpeg');
  assert.equal(file.name,`phone.photo-crop.${format}`);
  assert.equal(file.type,`image/${format}`);
  assert.deepEqual([...new Uint8Array(await file.arrayBuffer())],[0,255,128]);
 }
});
