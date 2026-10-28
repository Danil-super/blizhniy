'use client';
import {phoneVerification,PhoneClientError} from './client-phone-verification';
export const phonePlacementEvent='blizhniy-phone-placement';
export type PhonePlacementRequest={owner:string;resolve:()=>void;reject:(error:Error)=>void};
/** UX only: SQL rechecks actual phone authority at every publication transition. */
export async function ensurePhoneForPlacement(owner:string):Promise<void>{
 if(typeof document==='undefined'||document.querySelector<HTMLMetaElement>('meta[name="blizhniy-phone-verification"]')?.content!=='enabled')return;
 const status=await phoneVerification.status(owner);if(!status.required||status.verified)return;
 if(!status.available)throw new PhoneClientError('UNAVAILABLE');
 return new Promise<void>((resolve,reject)=>{
  const event=new CustomEvent<PhonePlacementRequest>(phonePlacementEvent,{cancelable:true,detail:{owner,resolve,reject}});
  window.dispatchEvent(event);
  if(!event.defaultPrevented)reject(new PhoneClientError('PHONE_REQUIRED'));
 });
}
