import type {PublicationTextField} from './publication-text-selection';

export type PublicationPrivacyTarget={
 owner:string;
 kind:'listing'|'vacancy'|'workRequest'|'specialist'|'fair'|'marquee';
 publicationId:string;
};

export type WithdrawPublicationText={action:'withdraw-text';field:PublicationTextField;fingerprint:string;start:number;end:number};
type Command={action?:'status'|'publication-status'|'withdraw-publication'|'photos'|'texts'}|{action:'withdraw-photo';photoId:string}|WithdrawPublicationText;

export function postPublicationPrivacy({owner,kind,publicationId}:PublicationPrivacyTarget,command:Command,signal:AbortSignal){
 return fetch('/api/account/publication-location',{
  method:'POST',credentials:'same-origin',redirect:'error',cache:'no-store',
  signal:AbortSignal.any([signal,AbortSignal.timeout(10000)]),
  headers:{'Content-Type':'application/json','X-Blizhniy-Request':'1'},
  body:JSON.stringify({kind,publicationId,expectedOwnerId:owner,...command}),
 });
}
