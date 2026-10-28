import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createListingThumbnailQueue} from '../src/lib/listing-thumbnail-queue.ts';

test('cabinet thumbnails use at most three concurrent private reads, each exactly once',async()=>{
 let active=0,peak=0,calls=0;const release=[];
 const read=createListingThumbnailQueue(async(_owner,id)=>{calls++;active++;peak=Math.max(peak,active);await new Promise(resolve=>release.push(resolve));active--;return id;});
 const promises=Array.from({length:8},(_,i)=>read('owner',String(i),{}));
 assert.equal(calls,3);
 while(release.length){release.shift()();await new Promise(resolve=>setImmediate(resolve));}
 assert.deepEqual(await Promise.all(promises),Array.from({length:8},(_,i)=>String(i)));
 assert.equal(peak,3);assert.equal(calls,8);
});
test('leaving a cabinet removes queued private reads without starting them',async()=>{
 let calls=0;const release=[];
 const read=createListingThumbnailQueue(async()=>{calls++;await new Promise(resolve=>release.push(resolve));return new Blob();});
 const first=Array.from({length:3},()=>read('owner','photo',{}));
 const controller=new AbortController();const queued=read('old-owner','private-photo',{signal:controller.signal});
 const denied=assert.rejects(queued,/aborted/);controller.abort();await denied;
 release.splice(0).forEach(done=>done());await Promise.all(first);assert.equal(calls,3);
});
test('failed read releases its slot, never retries, and an aborted request is not sent',async()=>{
 let calls=0;const controller=new AbortController();controller.abort();
 const read=createListingThumbnailQueue(async()=>{calls++;throw Error('offline');});
 await assert.rejects(read('owner','photo',{signal:controller.signal}),/aborted/);
 await assert.rejects(read('owner','photo',{}),/offline/);
 await assert.rejects(read('owner','photo',{}),/offline/);assert.equal(calls,2);
});
test('queue bounds pending thumbnails and does not send excess work',async()=>{
 let calls=0;const release=[];
 const read=createListingThumbnailQueue(async()=>{calls++;await new Promise(resolve=>release.push(resolve));return new Blob();});
 const pending=Array.from({length:67},()=>read('owner','photo',{}));
 await assert.rejects(read('owner','photo',{}),/queue full/);
 while(release.length){release.shift()();await new Promise(resolve=>setImmediate(resolve));}
 await Promise.all(pending);assert.equal(calls,67);
});
