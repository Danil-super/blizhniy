import {randomUUID} from 'node:crypto';
import {authJson,readAuthJson,AuthRequestError,type AuthRateLimiter} from './auth-http';
import {readAccountSessionToken} from './account-cookie';
import {getTrustedProxyIp} from './trusted-proxy-ip';
import {AppSessionAccessError} from './app-session-transaction';
import {ListingDraftAccessError,ListingDraftConflictError} from './postgres-listing-drafts';
import {ListingDraftInputError,parseListingDraftId,parseListingDraftRevision} from './listing-draft-contract.ts';
import {parseListingFormDraft} from './listing-form-contract.ts';
import type {PostgresListingFormStore} from './postgres-listing-form';
type Runtime={store:Pick<PostgresListingFormStore,'read'|'update'>;limiter:Pick<AuthRateLimiter,'allowProduction'>};
type Event={event:'listing_form_request';requestId:string;operation:string;status:number;durationMs:number;code?:string};
export function createProductionListingFormHandler(config:{origin:string},runtime:()=>Promise<Runtime>|Runtime,audit:(event:Event)=>void=event=>console.info(JSON.stringify(event))){
 return async(request:Request)=>{
  const requestId=randomUUID(),start=Date.now();let status=503,code:string|undefined;
  const reply=(body:unknown,next:number,headers?:Record<string,string>)=>{status=next;return authJson(body,next,{'X-Request-ID':requestId,...headers});};
  try{
   if(!['POST','PUT'].includes(request.method))throw new AuthRequestError(405,'METHOD_NOT_ALLOWED');
   const writing=request.method==='PUT',raw=await readAuthJson(request,config,2000,writing?'PUT':'POST',writing?65536:4096);
   if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new AuthRequestError(422,'INVALID_INPUT');
   const row=raw as Record<string,unknown>,keys=writing?['expectedOwnerId','listingId','expectedRevision','form']:['expectedOwnerId','listingId'];
   if(Object.keys(row).length!==keys.length||keys.some(key=>!Object.hasOwn(row,key)))throw new AuthRequestError(422,'INVALID_INPUT');
   const owner=parseListingDraftId(row.expectedOwnerId),id=parseListingDraftId(row.listingId),revision=writing?parseListingDraftRevision(row.expectedRevision):null;
   const form=writing?parseListingFormDraft(row.form):null,ip=getTrustedProxyIp(request.headers);
   if(!ip)throw new AuthRequestError(403,'UNTRUSTED_INGRESS');const token=readAccountSessionToken(request);if(!token)throw new AuthRequestError(401,'UNAUTHENTICATED');
   const {store,limiter}=await runtime();if(!await limiter.allowProduction('session',ip))throw new AuthRequestError(429,'RATE_LIMITED');
   return reply(form?await store.update(token,owner,id,revision,form):await store.read(token,owner,id),200);
  }catch(error){
   if(error instanceof AppSessionAccessError)error=new AuthRequestError(401,'UNAUTHENTICATED');
   if(error instanceof ListingDraftAccessError)error=new AuthRequestError(404,'DRAFT_NOT_FOUND');
   if(error instanceof ListingDraftConflictError)error=new AuthRequestError(409,'DRAFT_CHANGED');
   if(error instanceof ListingDraftInputError)error=new AuthRequestError(422,'INVALID_INPUT');
   code=error instanceof AuthRequestError?error.code:'FORM_UNAVAILABLE';const next=error instanceof AuthRequestError?error.status:503;
   return reply({error:{code}},next,next===429?{'Retry-After':'900'}:next===405?{Allow:'POST, PUT'}:undefined);
  }finally{audit({event:'listing_form_request',requestId,operation:request.method,status,durationMs:Date.now()-start,code});}
 };
}
