import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';
const load=createRequire(import.meta.url)('../scripts/local-primary-modules.cjs').loadLocalPrimaryModule;
const {ensurePhoneForPlacement,phonePlacementEvent}=load('phone-placement'),{phoneVerification}=load('client-phone-verification');
test('placement preflight preserves the pending action, cancellation and disabled mode without authorizing publication itself',async()=>{
 const oldDocument=globalThis.document,oldWindow=globalThis.window,status=phoneVerification.status;let calls=0;
 try{
  globalThis.document={querySelector:()=>({content:'disabled'})};phoneVerification.status=async()=>{calls++;throw Error('Must not fetch');};await ensurePhoneForPlacement('owner');assert.equal(calls,0);
  globalThis.document={querySelector:()=>({content:'enabled'})};globalThis.window=new EventTarget();
  phoneVerification.status=async()=>({required:false,verified:false,available:false});await ensurePhoneForPlacement('owner');
  phoneVerification.status=async()=>({required:true,verified:true,available:true});await ensurePhoneForPlacement('owner');
  phoneVerification.status=async()=>({required:true,verified:false,available:true});await assert.rejects(ensurePhoneForPlacement('owner'),{code:'PHONE_REQUIRED'});
  let action,finished=false;window.addEventListener(phonePlacementEvent,event=>{event.preventDefault();assert.equal(event.detail.owner,'owner');action=event.detail;},{once:true});const pending=ensurePhoneForPlacement('owner').then(()=>{finished=true;});await new Promise(r=>setImmediate(r));assert.equal(finished,false);action.resolve();await pending;assert.equal(finished,true);
  window.addEventListener(phonePlacementEvent,event=>{event.preventDefault();event.detail.reject(Error('Synthetic cancellation'));},{once:true});await assert.rejects(ensurePhoneForPlacement('owner'),/Synthetic cancellation/);
  phoneVerification.status=async()=>({required:true,verified:false,available:false});await assert.rejects(ensurePhoneForPlacement('owner'),{code:'UNAVAILABLE'});
 }finally{phoneVerification.status=status;if(oldDocument===undefined)delete globalThis.document;else globalThis.document=oldDocument;if(oldWindow===undefined)delete globalThis.window;else globalThis.window=oldWindow;}
});
