import {randomUUID} from 'node:crypto';
import {authJson,readAuthJson,AuthRequestError,type AuthRateLimiter} from './auth-http';
import {readAccountSessionToken} from './account-cookie';
import {getTrustedProxyIp} from './trusted-proxy-ip';
import {AppSessionAccessError} from './app-session-transaction';
import {ListingDraftAccessError,ListingDraftConflictError} from './postgres-listing-drafts';
import {ListingDraftInputError,parseListingDraftId,parseListingDraftRevision} from './listing-draft-contract.ts';
import {parseListingCheckout,ListingCheckoutInputError,ListingCheckoutConflictError,ListingCheckoutUnavailableError} from './listing-checkout-contract.ts';
import type {PostgresListingCheckoutStore} from './postgres-listing-checkout';
import type {createAccountTestListingPayment} from './account-test-listing-payment';

type Runtime={store:Pick<PostgresListingCheckoutStore,'preview'|'prepare'|'readIntent'|'readOrder'>;payments?:ReturnType<typeof createAccountTestListingPayment>|null;limiter:Pick<AuthRateLimiter,'allowProduction'>};
type Audit={event:'listing_checkout';requestId:string;status:number;durationMs:number;code?:string};
function exact(row:Record<string,unknown>,keys:string[]){
 if(Object.keys(row).length!==keys.length||keys.some(key=>!Object.hasOwn(row,key)))throw new AuthRequestError(422,'INVALID_INPUT');
}
/** Same-origin cookie boundary. Remote dispatch is opt-in, account-allowlisted and TEST-only. */
export function createListingCheckoutHandler(config:{origin:string},runtime:()=>Promise<Runtime>|Runtime,audit:(event:Audit)=>void=event=>console.info(JSON.stringify(event))){
 return async(request:Request)=>{
  const requestId=randomUUID(),start=Date.now();let status=503,code:string|undefined;
  const reply=(body:unknown,next:number,headers?:Record<string,string>)=>{status=next;return authJson(body,next,{'X-Request-ID':requestId,...headers});};
  try{
   if(request.method!=='POST'&&request.method!=='PUT')throw new AuthRequestError(405,'METHOD_NOT_ALLOWED');
   const raw=await readAuthJson(request,config,2000,request.method,4096);
   if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new AuthRequestError(422,'INVALID_INPUT');
   const row=raw as Record<string,unknown>,owner=parseListingDraftId(row.expectedOwnerId);
   let execute:(current:Runtime,token:string)=>Promise<unknown>;
   if(request.method==='PUT'){
    const value={...row};delete value.expectedOwnerId;
    const input=parseListingCheckout(value);execute=({store},token)=>store.prepare(token,owner,input);
   }else if(row.action==='testPreview'){
    exact(row,['expectedOwnerId','action','listingId','expectedRevision']);
    const id=parseListingDraftId(row.listingId),revision=parseListingDraftRevision(row.expectedRevision);
    execute=({payments},token)=>{if(!payments)throw new AuthRequestError(503,'CHECKOUT_DISABLED');return payments.preview(token,owner,id,revision);};
   }else if(row.action==='dispatch'){
    exact(row,['expectedOwnerId','action','paymentId']);const id=parseListingDraftId(row.paymentId);
    execute=({payments},token)=>{if(!payments)throw new AuthRequestError(503,'CHECKOUT_DISABLED');return payments.dispatch(token,owner,id);};
   }else if(row.action==='preview'){
    exact(row,['expectedOwnerId','action','listingId','expectedRevision']);
    const id=parseListingDraftId(row.listingId),revision=parseListingDraftRevision(row.expectedRevision);
    execute=({store},token)=>store.preview(token,owner,id,revision);
   }else if(row.action==='intent'){
    exact(row,['expectedOwnerId','action','creationKey']);const key=parseListingDraftId(row.creationKey);
    execute=({store},token)=>store.readIntent(token,owner,key);
   }else if(row.action==='order'){
    exact(row,['expectedOwnerId','action','paymentId']);const id=parseListingDraftId(row.paymentId);
    execute=({store},token)=>store.readOrder(token,owner,id);
   }else throw new AuthRequestError(422,'INVALID_INPUT');
   const ip=getTrustedProxyIp(request.headers);if(!ip)throw new AuthRequestError(403,'UNTRUSTED_INGRESS');
   const token=readAccountSessionToken(request);if(!token)throw new AuthRequestError(401,'UNAUTHENTICATED');
   const current=await runtime();if(!await current.limiter.allowProduction('session',ip))throw new AuthRequestError(429,'RATE_LIMITED');
   return reply(await execute(current,token),200);
  }catch(error){
   if(error instanceof AppSessionAccessError)error=new AuthRequestError(401,'UNAUTHENTICATED');
   if(error instanceof ListingDraftAccessError)error=new AuthRequestError(404,'DRAFT_NOT_FOUND');
   if(error instanceof ListingDraftConflictError)error=new AuthRequestError(409,'DRAFT_CHANGED');
   if(error instanceof ListingCheckoutConflictError)error=new AuthRequestError(409,'CHECKOUT_CHANGED');
   if(error instanceof ListingCheckoutUnavailableError)error=new AuthRequestError(409,'CHECKOUT_NOT_READY');
   if(error instanceof ListingDraftInputError||error instanceof ListingCheckoutInputError)error=new AuthRequestError(422,'INVALID_INPUT');
   code=error instanceof AuthRequestError?error.code:'CHECKOUT_UNAVAILABLE';const next=error instanceof AuthRequestError?error.status:503;
   return reply({error:{code}},next,next===429?{'Retry-After':'900'}:next===405?{Allow:'POST, PUT'}:undefined);
  }finally{audit({event:'listing_checkout',requestId,status,durationMs:Date.now()-start,code});}
 };
}
