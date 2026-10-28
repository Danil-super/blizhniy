import {authJson,readAuthJson,AuthRequestError,type AuthRateLimiter} from './auth-http';
import {readAccountSessionToken} from './account-cookie';
import {getTrustedProxyIp} from './trusted-proxy-ip';
import {AppSessionAccessError} from './app-session-transaction';
import {ListingDraftInputError,parseListingDraftCursor,parseListingDraftId} from './listing-draft-contract.ts';
import type {PostgresListingCabinetStore} from './postgres-listing-cabinet';
type Runtime={store:Pick<PostgresListingCabinetStore,'list'>;limiter:Pick<AuthRateLimiter,'allowProduction'>};
export function createListingCabinetHandler(config:{origin:string},runtime:()=>Promise<Runtime>){return async(request:Request)=>{
 try{
  if(request.method!=='POST')return authJson({error:{code:'METHOD_NOT_ALLOWED'}},405,{Allow:'POST'});
  const raw=await readAuthJson(request,config,2000,'POST',4096);
  if(!raw||typeof raw!=='object'||Array.isArray(raw)||Object.keys(raw).sort().join()!=='cursor,expectedOwnerId')throw new AuthRequestError(422,'INVALID_INPUT');
  const row=raw as Record<string,unknown>,owner=parseListingDraftId(row.expectedOwnerId),cursor=parseListingDraftCursor(row.cursor);
  const ip=getTrustedProxyIp(request.headers);if(!ip)throw new AuthRequestError(403,'UNTRUSTED_INGRESS');
  const token=readAccountSessionToken(request);if(!token)throw new AuthRequestError(401,'UNAUTHENTICATED');
  const state=await runtime();
  if(!await state.limiter.allowProduction('session',ip))return authJson({error:{code:'RATE_LIMITED'}},429,{'Retry-After':'900'});
  return authJson(await state.store.list(token,owner,cursor),200);
 }catch(error){
  if(error instanceof AppSessionAccessError)error=new AuthRequestError(401,'UNAUTHENTICATED');
  if(error instanceof ListingDraftInputError)error=new AuthRequestError(422,'INVALID_INPUT');
  return authJson({error:{code:error instanceof AuthRequestError?error.code:'LISTINGS_UNAVAILABLE'}},error instanceof AuthRequestError?error.status:503);
 }
};}
