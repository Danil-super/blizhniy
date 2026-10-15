import {randomUUID} from 'node:crypto';
import {authJson,readAuthJson,AuthRequestError,type AuthRateLimiter} from './auth-http';
import {readAccountSessionToken} from './account-cookie';import {getTrustedProxyIp} from './trusted-proxy-ip';
import {AppSessionAccessError} from './app-session-transaction';
import {ListingDraftAccessError,ListingDraftConflictError} from './postgres-listing-drafts';
import {ListingDraftInputError,parseListingDraftId,parseListingDraftRevision} from './listing-draft-contract.ts';
import type {PostgresListingFormStore} from './postgres-listing-form';
type Runtime={store:Pick<PostgresListingFormStore,'checkPublication'>;limiter:Pick<AuthRateLimiter,'allowProduction'>};
type Event={event:'listing_publication_check';requestId:string;status:number;durationMs:number;code?:string};
export function createProductionListingPublicationHandler(config:{origin:string},runtime:()=>Promise<Runtime>|Runtime,audit:(event:Event)=>void=event=>console.info(JSON.stringify(event))){
 return async(request:Request)=>{
  const requestId=randomUUID(),start=Date.now();let status=503,code:string|undefined;
  const reply=(body:unknown,next:number,headers?:Record<string,string>)=>{status=next;return authJson(body,next,{'X-Request-ID':requestId,...headers});};
  try{
   if(request.method!=='POST')throw new AuthRequestError(405,'METHOD_NOT_ALLOWED');
   const raw=await readAuthJson(request,config,2000,'POST',4096);
   if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new AuthRequestError(422,'INVALID_INPUT');
   const row=raw as Record<string,unknown>,keys=['expectedOwnerId','listingId','expectedRevision'];
   if(Object.keys(row).length!==3||keys.some(key=>!Object.hasOwn(row,key)))throw new AuthRequestError(422,'INVALID_INPUT');
   const owner=parseListingDraftId(row.expectedOwnerId),id=parseListingDraftId(row.listingId),revision=parseListingDraftRevision(row.expectedRevision),ip=getTrustedProxyIp(request.headers);
   if(!ip)throw new AuthRequestError(403,'UNTRUSTED_INGRESS');const token=readAccountSessionToken(request);if(!token)throw new AuthRequestError(401,'UNAUTHENTICATED');
   const {store,limiter}=await runtime();if(!await limiter.allowProduction('session',ip))throw new AuthRequestError(429,'RATE_LIMITED');
   return reply(await store.checkPublication(token,owner,id,revision),200);
  }catch(error){
   if(error instanceof AppSessionAccessError)error=new AuthRequestError(401,'UNAUTHENTICATED');
   if(error instanceof ListingDraftAccessError)error=new AuthRequestError(404,'DRAFT_NOT_FOUND');
   if(error instanceof ListingDraftConflictError)error=new AuthRequestError(409,'DRAFT_CHANGED');
   if(error instanceof ListingDraftInputError)error=new AuthRequestError(422,'INVALID_INPUT');
   code=error instanceof AuthRequestError?error.code:'PUBLICATION_CHECK_UNAVAILABLE';const next=error instanceof AuthRequestError?error.status:503;
   return reply({error:{code}},next,next===429?{'Retry-After':'900'}:next===405?{Allow:'POST'}:undefined);
  }finally{audit({event:'listing_publication_check',requestId,status,durationMs:Date.now()-start,code});}
 };
}
