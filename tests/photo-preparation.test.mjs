import assert from 'node:assert/strict';
import {test} from 'node:test';
import {preparePhotoFile,preparePhotoFiles,maxPhotoSourceBytes} from '../src/lib/prepare-photo.ts';

test('photo source limits reject unsupported, empty and excessive files before decoding',async()=>{
 for(const file of [new File(['x'],'vector.svg',{type:'image/svg+xml'}),new File([],'empty.png',{type:'image/png'})])await assert.rejects(preparePhotoFile(file));
 const large=new File(['x'],'large.png',{type:'image/png'});Object.defineProperty(large,'size',{value:maxPhotoSourceBytes+1});
 await assert.rejects(preparePhotoFile(large),/50 МБ/);
});

test('GIF is not flattened in the browser and still requires server static-image validation',async()=>{
 const file=new File([Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7','base64')],'static.gif',{type:'image/gif'});
 assert.equal(await preparePhotoFile(file),file);
});

test('photo preparation bounds dimensions/bytes, retries encoding and releases decoded resources',async()=>{
 const saved={document:globalThis.document,createImageBitmap:globalThis.createImageBitmap},canvases=[];let closed=0,encodings=0;
 globalThis.createImageBitmap=async()=>({width:4000,height:3000,close(){closed++;}});
 globalThis.document={createElement(name){assert.equal(name,'canvas');const canvas={width:0,height:0,getContext:()=>({drawImage(){}}),toBlob(callback,type){assert.equal(canvas.width,2048);assert.equal(canvas.height,1536);encodings++;callback(new Blob([new Uint8Array(encodings===1?2097153:100)],{type}));}};canvases.push(canvas);return canvas;}};
 try{
  const file=await preparePhotoFile(new File(['synthetic-source'],'phone.png',{type:'image/png'}));
  assert.equal(file.type,'image/webp');assert.equal(file.size,100);assert.equal(file.name,'phone.png');
  assert.equal(encodings,2);assert.equal(closed,1);assert.equal(canvases[0].width,0);assert.equal(canvases[0].height,0);
 }finally{Object.assign(globalThis,saved);}
});

test('a failed photo does not discard later valid files and pixel failures release the bitmap',async()=>{
 const saved={document:globalThis.document,createImageBitmap:globalThis.createImageBitmap};let closed=0;
 globalThis.createImageBitmap=async()=>({width:10000,height:10000,close(){closed++;}});
 globalThis.document={createElement:()=>({width:0,height:0})};
 try{
  const gif=new File(['GIF89a'],'kept.gif',{type:'image/gif'});
  const result=await preparePhotoFiles([new File(['x'],'too-many-pixels.png',{type:'image/png'}),gif]);
  assert.deepEqual(result.accepted,[gif]);assert.equal(result.rejectedMessages.length,1);assert.match(result.rejectedMessages[0],/64 мегапикселя/);assert.equal(closed,1);
 }finally{Object.assign(globalThis,saved);}
});
