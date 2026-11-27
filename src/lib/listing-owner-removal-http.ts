import {authJson,readAuthJson,AuthRequestError,type AuthRateLimiter} from './auth-http';
import {readAccountSessionToken} from './account-cookie';
import {getTrustedProxyIp} from './trusted-proxy-ip';
import {AppSessionAccessError} from './app-session-transaction';
import {ListingDraftAccessError,ListingDraftConflictError} from './postgres-listing-drafts';
import {ListingDraftInputError} from './listing-draft-contract.ts';
import {parseListingOwnerRemovalRequest} from './listing-owner-removal-contract.ts';
import {DraftRemovalCheckoutActiveError,type PostgresListingOwnerRemovalStore} from './postgres-listing-owner-removals';
type Runtime={store:Pick<PostgresListingOwnerRemovalStore,'read'|'remove'>;limiter:Pick<AuthRateLimiter,'allowProduction'>};
export function createListingOwnerRemovalHandler(config:{origin:string;draftRemovals?:boolean;postmoderation?:boolean},getRuntime:()=>Promise<Runtime>){return async(request:Request)=>{
 try{
  if(request.method!=='POST')return authJson({error:{code:'METHOD_NOT_ALLOWED'}},405,{Allow:'POST'});
  const body=parseListingOwnerRemovalRequest(await readAuthJson(request,config,2000,'POST',4096));
  if(body.target?config.draftRemovals!==true:config.postmoderation===false)throw new AuthRequestError(404,'NOT_FOUND');
  const ip=getTrustedProxyIp(request.headers),token=readAccountSessionToken(request);
  if(!ip)throw new AuthRequestError(403,'UNTRUSTED_INGRESS');if(!token)throw new AuthRequestError(401,'UNAUTHENTICATED');
  const runtime=await getRuntime();if(!await runtime.limiter.allowProduction('session',ip))throw new AuthRequestError(429,'RATE_LIMITED');
  const args=[token,body.expectedOwnerId,body.listingId,body.expectedRevision] as const;
  return authJson(await runtime.store[body.action](...args,...(body.target?[body.target] as const:[])),200);
 }catch(error){
  if(error instanceof DraftRemovalCheckoutActiveError)return authJson({error:{code:'CHECKOUT_ACTIVE'}},409);
  const status=error instanceof AuthRequestError?error.status:error instanceof AppSessionAccessError?401:error instanceof ListingDraftAccessError?404:error instanceof ListingDraftConflictError?409:error instanceof ListingDraftInputError?422:503;
  const code=error instanceof AuthRequestError?error.code:status===401?'UNAUTHENTICATED':status===404?'DRAFT_NOT_FOUND':status===409?'DRAFT_CHANGED':status===422?'INVALID_INPUT':'REMOVAL_UNAVAILABLE';
  return authJson({error:{code}},status,status===429?{'Retry-After':'900'}:undefined);
 }
};}
