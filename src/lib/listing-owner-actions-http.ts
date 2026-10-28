import {authJson,readAuthJson,AuthRequestError,type AuthRateLimiter} from './auth-http';
import {readAccountSessionToken} from './account-cookie';
import {getTrustedProxyIp} from './trusted-proxy-ip';
import {AppSessionAccessError} from './app-session-transaction';
import {ListingDraftAccessError,ListingDraftConflictError} from './postgres-listing-drafts';
import {parseListingDraftId,parseListingDraftRevision,ListingDraftInputError} from './listing-draft-contract.ts';
import type {PostgresListingOwnerActions} from './postgres-listing-owner-actions';
type Runtime={store:Pick<PostgresListingOwnerActions,'change'>;limiter:Pick<AuthRateLimiter,'allowProduction'>};
export function createListingOwnerActionsHandler(config:{origin:string},getRuntime:()=>Promise<Runtime>){return async(request:Request)=>{
 try{
  if(request.method!=='POST')return authJson({error:{code:'METHOD_NOT_ALLOWED'}},405,{Allow:'POST'});
  const raw=await readAuthJson(request,config,2000,'POST',4096);
  if(!raw||typeof raw!=='object'||Array.isArray(raw)||Object.keys(raw).sort().join()!=='action,expectedOwnerId,expectedRevision,listingId')throw new AuthRequestError(422,'INVALID_INPUT');
  const row=raw as Record<string,unknown>,owner=parseListingDraftId(row.expectedOwnerId),id=parseListingDraftId(row.listingId),revision=parseListingDraftRevision(row.expectedRevision);
  if(row.action!=='withdraw'&&row.action!=='restore')throw new AuthRequestError(422,'INVALID_INPUT');
  const ip=getTrustedProxyIp(request.headers),token=readAccountSessionToken(request);
  if(!ip)throw new AuthRequestError(403,'UNTRUSTED_INGRESS');if(!token)throw new AuthRequestError(401,'UNAUTHENTICATED');
  const runtime=await getRuntime();if(!await runtime.limiter.allowProduction('session',ip))throw new AuthRequestError(429,'RATE_LIMITED');
  return authJson(await runtime.store.change(token,owner,id,revision,row.action),200);
 }catch(error){
  if(error&&typeof error==='object'&&'code'in error&&error.code==='P7601')error=new AuthRequestError(403,'PHONE_REQUIRED');
  const status=error instanceof AuthRequestError?error.status:error instanceof AppSessionAccessError?401:error instanceof ListingDraftAccessError?404:error instanceof ListingDraftConflictError?409:error instanceof ListingDraftInputError?422:503;
  const code=error instanceof AuthRequestError?error.code:status===401?'UNAUTHENTICATED':status===404?'DRAFT_NOT_FOUND':status===409?'DRAFT_CHANGED':status===422?'INVALID_INPUT':'ACTION_UNAVAILABLE';
  return authJson({error:{code}},status,status===429?{'Retry-After':'900'}:undefined);
 }
};}
