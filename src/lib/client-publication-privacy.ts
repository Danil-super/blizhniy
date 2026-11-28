import type {PublicationTextField} from './publication-text-selection';

export type PublicationPrivacyTarget={
 owner:string;
 kind:'listing'|'vacancy'|'workRequest'|'specialist'|'fair'|'marquee';
 publicationId:string;
};

export type WithdrawPublicationText={action:'withdraw-text';field:PublicationTextField;fingerprint:string;start:number;end:number};
export type ContactConsentCategory='phone'|'messenger';
export type ProfileConsentCategory='name'|'avatar';
type Command={action?:'status'|'publication-status'|'withdraw-publication'|'photos'|'texts'|'location-consent-status'}|
 {action:'withdraw-photo';photoId:string}|WithdrawPublicationText|
 {action:'confirm-location-consent';fingerprint:string;fullName:string}|
 {action:'contact-consent-status'|'withdraw-contact';category:ContactConsentCategory}|
 {action:'confirm-contact-consent';category:ContactConsentCategory;fingerprint:string;fullName:string}|
 {action:'profile-consent-status'|'withdraw-profile-value';category:ProfileConsentCategory}|
 {action:'confirm-profile-consent';category:ProfileConsentCategory;fingerprint:string;fullName:string}|
 {action:'photo-consent-status';photoId:string}|
 {action:'confirm-photo-consent';photoId:string;fingerprint:string;fullName:string}|
 {action:'link-consent-status'|'withdraw-link'}|
 {action:'confirm-link-consent';fingerprint:string;fullName:string}|
 {action:'text-consent-status'|'withdraw-text-field';field:PublicationTextField}|
 {action:'confirm-text-consent';field:PublicationTextField;fingerprint:string;fullName:string};

export function postPublicationPrivacy({owner,kind,publicationId}:PublicationPrivacyTarget,command:Command,signal:AbortSignal){
 return fetch('/api/account/publication-location',{
  method:'POST',credentials:'same-origin',redirect:'error',cache:'no-store',
  signal:AbortSignal.any([signal,AbortSignal.timeout(10000)]),
  headers:{'Content-Type':'application/json','X-Blizhniy-Request':'1'},
  body:JSON.stringify({kind,publicationId,expectedOwnerId:owner,...command}),
 });
}
