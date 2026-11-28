export type PublicationPrivacyTarget={
 owner:string;
 kind:'listing'|'vacancy'|'workRequest'|'specialist'|'fair'|'marquee';
 publicationId:string;
};

type Command={action?:'status'|'publication-status'|'withdraw-publication'|'photos'}|{action:'withdraw-photo';photoId:string};

export function postPublicationPrivacy({owner,kind,publicationId}:PublicationPrivacyTarget,command:Command,signal:AbortSignal){
 return fetch('/api/account/publication-location',{
  method:'POST',credentials:'same-origin',redirect:'error',cache:'no-store',
  signal:AbortSignal.any([signal,AbortSignal.timeout(10000)]),
  headers:{'Content-Type':'application/json','X-Blizhniy-Request':'1'},
  body:JSON.stringify({kind,publicationId,expectedOwnerId:owner,...command}),
 });
}
