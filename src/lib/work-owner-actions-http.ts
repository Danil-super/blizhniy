import {authJson,readAuthJson,AuthRequestError,type AuthRateLimiter} from './auth-http';
import {readAccountSessionToken} from './account-cookie';import {getTrustedProxyIp} from './trusted-proxy-ip';
import {AppSessionAccessError} from './app-session-transaction';
import {parseListingDraftId,ListingDraftInputError} from './listing-draft-contract.ts';
import {parseWorkOwnerAction,WorkOwnerActionInputError} from './work-owner-actions-contract.ts';
import {WorkOwnerActionAccessError,WorkOwnerActionConflictError,WorkOwnerActionBusyError,WorkOwnerActionPaymentPendingError,type PostgresWorkOwnerActions} from './postgres-work-owner-actions.ts';
type Runtime={store:Pick<PostgresWorkOwnerActions,'change'>;limiter:Pick<AuthRateLimiter,'allowProduction'>};
export function createWorkOwnerActionsHandler(config:{origin:string},runtime:()=>Promise<Runtime>){return async(request:Request)=>{
 try{
  if(request.method!=='POST')throw new AuthRequestError(405,'METHOD_NOT_ALLOWED');
  const raw=await readAuthJson(request,config,2000,'POST',4096);
  if(!raw||typeof raw!=='object'||Array.isArray(raw)||!Object.hasOwn(raw,'expectedOwnerId'))throw new WorkOwnerActionInputError();
  const {expectedOwnerId,...rest}=raw as Record<string,unknown>,owner=parseListingDraftId(expectedOwnerId),input=parseWorkOwnerAction(rest);
  const ip=getTrustedProxyIp(request.headers),token=readAccountSessionToken(request);
  if(!ip)throw new AuthRequestError(403,'UNTRUSTED_INGRESS');if(!token)throw new AuthRequestError(401,'UNAUTHENTICATED');
  const {store,limiter}=await runtime();if(!await limiter.allowProduction('session',ip))throw new AuthRequestError(429,'RATE_LIMITED');
  return authJson(await store.change(token,owner,input),200);
 }catch(error){
  if(error instanceof AppSessionAccessError)error=new AuthRequestError(401,'UNAUTHENTICATED');
  if(error instanceof WorkOwnerActionInputError||error instanceof ListingDraftInputError)error=new AuthRequestError(422,'INVALID_INPUT');
  if(error instanceof WorkOwnerActionAccessError)error=new AuthRequestError(404,'PUBLICATION_NOT_FOUND');
  if(error instanceof WorkOwnerActionConflictError)error=new AuthRequestError(409,'PUBLICATION_CHANGED');
  if(error instanceof WorkOwnerActionPaymentPendingError)error=new AuthRequestError(409,'RESPONSE_PAYMENT_PENDING');
  if(error instanceof WorkOwnerActionBusyError)error=new AuthRequestError(409,'ACTION_BUSY');
  if(error&&typeof error==='object'&&'code'in error&&error.code==='P7601')error=new AuthRequestError(403,'PHONE_REQUIRED');
  const status=error instanceof AuthRequestError?error.status:503,code=error instanceof AuthRequestError?error.code:'ACTION_UNAVAILABLE';
  return authJson({error:{code}},status,status===429?{'Retry-After':'900'}:status===405?{Allow:'POST'}:undefined);
 }
};}
