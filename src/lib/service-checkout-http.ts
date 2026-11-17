import {randomUUID} from 'node:crypto';
import {authJson,readAuthJson,AuthRequestError,type AuthRateLimiter} from './auth-http';
import {readAccountSessionToken} from './account-cookie';
import {getTrustedProxyIp} from './trusted-proxy-ip';
import {AppSessionAccessError} from './app-session-transaction';
import {ListingDraftInputError,parseListingDraftId,parseListingDraftRevision} from './listing-draft-contract.ts';
import {ServicePublicationAccessError,ServicePublicationConflictError} from './postgres-service-publications';
import {parseServiceCheckout,ServiceCheckoutInputError,ServiceCheckoutConflictError,ServiceCheckoutUnavailableError,type PaidServiceKind} from './service-checkout-contract.ts';
import type {PostgresServiceCheckoutStore} from './postgres-service-checkout';
type Runtime={store:Pick<PostgresServiceCheckoutStore,'preview'|'prepare'|'readIntent'|'readOrder'>;limiter:Pick<AuthRateLimiter,'allowProduction'>;dispatch(token:string,owner:string,id:string):Promise<{isTest:boolean;confirmationUrl:string|null}>};
function exact(row:Record<string,unknown>,keys:string[]){if(Reflect.ownKeys(row).length!==keys.length||keys.some(key=>!Object.hasOwn(row,key)))throw new AuthRequestError(422,'INVALID_INPUT');}
/** Same-origin local cookie boundary. No service/provider authority is taken from request fields. */
export function createServiceCheckoutHandler(config:{origin:string},kind:PaidServiceKind,current:Runtime){
 return async(request:Request)=>{
  const requestId=randomUUID();
  const reply=(body:unknown,status:number)=>authJson(body,status,{'X-Request-ID':requestId});
  try{
   if(!['POST','PUT'].includes(request.method))throw new AuthRequestError(405,'METHOD_NOT_ALLOWED');
   const row=await readAuthJson(request,config,2000,request.method==='PUT'?'PUT':'POST',4096) as Record<string,unknown>;
   if(!row||typeof row!=='object'||Array.isArray(row))throw new AuthRequestError(422,'INVALID_INPUT');
   const owner=parseListingDraftId(row.expectedOwnerId);let execute:(token:string)=>Promise<unknown>;
   if(request.method==='PUT'){
    const input={...row};delete input.expectedOwnerId;const parsed=parseServiceCheckout(kind,input);execute=token=>current.store.prepare(token,owner,parsed);
   }else if(row.action==='preview'){
    exact(row,['expectedOwnerId','action','publicationId','expectedRevision']);const id=parseListingDraftId(row.publicationId),revision=parseListingDraftRevision(row.expectedRevision);execute=token=>current.store.preview(token,owner,id,revision);
   }else if(row.action==='intent'){
    exact(row,['expectedOwnerId','action','creationKey']);const key=parseListingDraftId(row.creationKey);execute=token=>current.store.readIntent(token,owner,key);
   }else if(row.action==='order'||row.action==='dispatch'){
    exact(row,['expectedOwnerId','action','paymentId']);const id=parseListingDraftId(row.paymentId);execute=token=>row.action==='order'?current.store.readOrder(token,owner,id):current.dispatch(token,owner,id);
   }else throw new AuthRequestError(422,'INVALID_INPUT');
   const ip=getTrustedProxyIp(request.headers);if(!ip)throw new AuthRequestError(403,'UNTRUSTED_INGRESS');
   const token=readAccountSessionToken(request);if(!token)throw new AuthRequestError(401,'UNAUTHENTICATED');
   if(!await current.limiter.allowProduction('session',ip))throw new AuthRequestError(429,'RATE_LIMITED');
   return reply(await execute(token),200);
  }catch(error){
   if(error&&typeof error==='object'&&'code'in error&&error.code==='PCA02')error=new AuthRequestError(409,'CHECKOUT_NOT_READY');
   if(error instanceof AppSessionAccessError)error=new AuthRequestError(401,'UNAUTHENTICATED');
   if(error instanceof ServicePublicationAccessError)error=new AuthRequestError(404,'PUBLICATION_NOT_FOUND');
   if(error instanceof ServicePublicationConflictError||error instanceof ServiceCheckoutConflictError)error=new AuthRequestError(409,'CHECKOUT_CHANGED');
   if(error instanceof ServiceCheckoutUnavailableError)error=new AuthRequestError(409,'CHECKOUT_NOT_READY');
   if(error instanceof ListingDraftInputError||error instanceof ServiceCheckoutInputError)error=new AuthRequestError(422,'INVALID_INPUT');
   if(error&&typeof error==='object'&&'code'in error&&error.code==='P7601')error=new AuthRequestError(403,'PHONE_REQUIRED');
   return reply({error:{code:error instanceof AuthRequestError?error.code:'CHECKOUT_UNAVAILABLE'}},error instanceof AuthRequestError?error.status:503);
  }
 };
}
