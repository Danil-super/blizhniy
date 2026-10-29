'use client';
export type PendingPhoneWindow={owner:string;attemptId:string|null;popup:Window;created:number};
/** Tab-local UI memory only. Every completion is rechecked using the session API.
 * Survives temporary auth-loading unmounts; no phone, credential or storage writes. */
export function createPhoneWindowMemory(){
 let pending:PendingPhoneWindow|null=null;
 const cancel=()=>{const previous=pending;pending=null;previous?.popup.close();};
 return {
  resume(owner:string){
   if(pending&&(pending.owner!==owner||Date.now()-pending.created>=600000))cancel();
   return pending;
  },
  begin(owner:string,popup:Window){cancel();pending={owner,popup,created:Date.now(),attemptId:null};return pending;},
  isCurrent(value:PendingPhoneWindow){return pending===value;},
  finish(value:PendingPhoneWindow){if(pending===value)pending=null;},
  cancel,
 };
}
export const phoneWindowMemory=createPhoneWindowMemory();
export function openPhoneVerificationChannel():BroadcastChannel|null{
 if(typeof BroadcastChannel==='undefined')return null;
 try{return new BroadcastChannel('blizhniy-phone-verification');}catch{return null;}
}
