import {authJson,readAuthJson,AuthRequestError,type AuthRateLimiter} from './auth-http';
import {readAccountSessionToken} from './account-cookie';import {getTrustedProxyIp} from './trusted-proxy-ip';
import {AppSessionAccessError} from './app-session-transaction';
import {parseListingDraftId,ListingDraftInputError} from './listing-draft-contract.ts';
import {parseCheckoutCancellation,CheckoutCancellationInputError,type CheckoutCancellationTargets} from './checkout-cancellation-contract.ts';
import {CheckoutCancellationError,type PostgresCheckoutCancellation} from './postgres-checkout-cancellation';
type Runtime={store:Pick<PostgresCheckoutCancellation,'read'|'cancel'>;limiter:Pick<AuthRateLimiter,'allowProduction'>};
export function createCheckoutCancellationHandler(config:{origin:string},runtime:()=>Runtime|Promise<Runtime>,targets:CheckoutCancellationTargets={}){return async(request:Request)=>{
 try{
  if(!['POST','PUT'].includes(request.method))throw new AuthRequestError(405,'METHOD_NOT_ALLOWED');
  const raw=await readAuthJson(request,config,2000,request.method==='PUT'?'PUT':'POST',4096);
  if(!raw||typeof raw!=='object'||Array.isArray(raw)||!Object.hasOwn(raw,'expectedOwnerId'))throw new CheckoutCancellationInputError();
  const {expectedOwnerId,...rest}=raw as Record<string,unknown>,owner=parseListingDraftId(expectedOwnerId),input=parseCheckoutCancellation(rest,targets);
  const ip=getTrustedProxyIp(request.headers);if(!ip)throw new AuthRequestError(403,'UNTRUSTED_INGRESS');
  const token=readAccountSessionToken(request);if(!token)throw new AuthRequestError(401,'UNAUTHENTICATED');
  const {store,limiter}=await runtime();if(!await limiter.allowProduction('session',ip))throw new AuthRequestError(429,'RATE_LIMITED');
  return authJson(await store[request.method==='PUT'?'cancel':'read'](token,owner,input),200);
 }catch(error){
  if(error instanceof AppSessionAccessError)error=new AuthRequestError(401,'UNAUTHENTICATED');
  if(error instanceof ListingDraftInputError||error instanceof CheckoutCancellationInputError)error=new AuthRequestError(422,'INVALID_INPUT');
  if(error instanceof CheckoutCancellationError)error=new AuthRequestError(error.code==='CHECKOUT_NOT_FOUND'?404:409,error.code);
  const status=error instanceof AuthRequestError?error.status:503,code=error instanceof AuthRequestError?error.code:'CANCELLATION_UNAVAILABLE';
  return authJson({error:{code}},status,status===429?{'Retry-After':'900'}:status===405?{Allow:'POST, PUT'}:undefined);
 }
};}
