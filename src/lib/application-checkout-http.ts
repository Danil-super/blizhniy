import {authJson,readAuthJson,AuthRequestError,type AuthRateLimiter} from './auth-http';
import {readAccountSessionToken} from './account-cookie';import {getTrustedProxyIp} from './trusted-proxy-ip';import {AppSessionAccessError} from './app-session-transaction';
import {ApplicationAccessError,ApplicationConflictError,ApplicationEligibilityError,ApplicationBusyError} from './postgres-applications';
import {parseListingDraftId,parseListingDraftRevision,ListingDraftInputError} from './listing-draft-contract.ts';
import {parseApplicationCheckout,ApplicationCheckoutInputError,ApplicationCheckoutConflictError,ApplicationCheckoutUnavailableError} from './application-checkout-contract.ts';
import type {PostgresApplicationCheckoutStore} from './postgres-application-checkout';
type Runtime={store:PostgresApplicationCheckoutStore;limiter:Pick<AuthRateLimiter,'allowProduction'>;dispatch:(token:string,owner:string,id:string)=>Promise<{confirmationUrl:string|null;isTest:true}>};
/** Validate the request before acquiring a database connection. */
export function createApplicationCheckoutHandler(origin:string,provide:Runtime|(()=>Promise<Runtime>)){return async(request:Request)=>{
 try{
  if(!['POST','PUT'].includes(request.method))throw new AuthRequestError(405,'METHOD_NOT_ALLOWED');
  const value=await readAuthJson(request,{origin},2000,request.method==='PUT'?'PUT':'POST',4096);if(!value||typeof value!=='object'||Array.isArray(value))throw new AuthRequestError(422,'INVALID_INPUT');
  const row=value as Record<string,unknown>,owner=parseListingDraftId(row.expectedOwnerId);let work:(runtime:Runtime,token:string)=>Promise<unknown>;
  if(request.method==='PUT'){const input={...row};delete input.expectedOwnerId;const parsed=parseApplicationCheckout(input);work=(runtime,token)=>runtime.store.prepare(token,owner,parsed);}
  else{
   const fields:Record<string,string[]>={preview:['applicationId','expectedRevision'],intent:['creationKey'],order:['paymentId'],dispatch:['paymentId']},action=row.action;
   if(typeof action!=='string'||!Object.hasOwn(fields,action))throw new AuthRequestError(422,'INVALID_INPUT');
   const keys=['expectedOwnerId','action',...fields[action]];if(Object.keys(row).length!==keys.length||keys.some(key=>!Object.hasOwn(row,key)))throw new AuthRequestError(422,'INVALID_INPUT');
   if(action==='preview'){const id=parseListingDraftId(row.applicationId),revision=parseListingDraftRevision(row.expectedRevision);work=(runtime,token)=>runtime.store.preview(token,owner,id,revision);}
   else if(action==='intent'){const key=parseListingDraftId(row.creationKey);work=(runtime,token)=>runtime.store.readIntent(token,owner,key);}
   else{const id=parseListingDraftId(row.paymentId);work=(runtime,token)=>action==='order'?runtime.store.readOrder(token,owner,id):runtime.dispatch(token,owner,id);}
  }
  const ip=getTrustedProxyIp(request.headers);if(!ip)throw new AuthRequestError(403,'UNTRUSTED_INGRESS');const token=readAccountSessionToken(request);if(!token)throw new AuthRequestError(401,'UNAUTHENTICATED');
  const runtime=typeof provide==='function'?await provide():provide;
  if(!await runtime.limiter.allowProduction('session',ip))throw new AuthRequestError(429,'RATE_LIMITED');return authJson(await work(runtime,token),200);
 }catch(error){
  if(error&&typeof error==='object'&&'code'in error&&error.code==='PCA02')error=new AuthRequestError(409,'CHECKOUT_CHANGED');
  const status=error instanceof AuthRequestError?error.status:error instanceof AppSessionAccessError?401:error instanceof ApplicationAccessError?404:error instanceof ApplicationConflictError||error instanceof ApplicationCheckoutConflictError||error instanceof ApplicationEligibilityError||error instanceof ApplicationBusyError||error instanceof ApplicationCheckoutUnavailableError?409:error instanceof ApplicationCheckoutInputError||error instanceof ListingDraftInputError?422:503;
  const code=error instanceof AuthRequestError?error.code:status===401?'UNAUTHENTICATED':status===404?'APPLICATION_NOT_FOUND':status===409?'CHECKOUT_CHANGED':status===422?'INVALID_INPUT':'CHECKOUT_UNAVAILABLE';
  return authJson({error:{code}},status,status===429?{'Retry-After':'900'}:undefined);
 }
};}
