import {randomUUID} from 'node:crypto';
import {authJson,readAuthJson,AuthRequestError,type AuthRateLimiter} from './auth-http';
import {readAccountSessionToken} from './account-cookie';
import {getTrustedProxyIp} from './trusted-proxy-ip';
import {AppSessionAccessError} from './app-session-transaction';
import {ListingDraftInputError,parseListingDraftId,parseListingDraftCursor} from './listing-draft-contract.ts';
import type {PostgresNotificationInbox} from './postgres-notification-inbox';
type Runtime={store:Pick<PostgresNotificationInbox,'list'|'mark'>;limiter:Pick<AuthRateLimiter,'allowProduction'>};
type Event={event:'notification_inbox_request';requestId:string;operation:string;status:number;durationMs:number;code?:string};

export function createProductionNotificationInboxHandler(config:{origin:string},runtime:()=>Runtime|Promise<Runtime>,audit:(event:Event)=>void=event=>console.info(JSON.stringify(event))){
 return async(request:Request)=>{
  const requestId=randomUUID(),start=Date.now();let status=503,code:string|undefined,operation='invalid';
  const reply=(value:unknown,next:number,headers?:Record<string,string>)=>{status=next;return authJson(value,next,{'X-Request-ID':requestId,...headers});};
  try{
   if(!['POST','PUT'].includes(request.method))throw new AuthRequestError(405,'METHOD_NOT_ALLOWED');
   const writing=request.method==='PUT',raw=await readAuthJson(request,config,2000,writing?'PUT':'POST',4096);
   if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new AuthRequestError(422,'INVALID_INPUT');
   const row=raw as Record<string,unknown>,action=row.action;
   if((writing? action!=='read'&&action!=='dismiss':action!=='list'))throw new AuthRequestError(422,'INVALID_INPUT');
   const keys=['action','expectedOwnerId',writing?'ids':'after'];
   if(Object.keys(row).length!==keys.length||keys.some(key=>!Object.hasOwn(row,key)))throw new AuthRequestError(422,'INVALID_INPUT');
   const owner=parseListingDraftId(row.expectedOwnerId),cursor=writing?null:parseListingDraftCursor(row.after);
   let ids:string[]=[];
   if(writing){
    if(!Array.isArray(row.ids)||row.ids.length<1||row.ids.length>20)throw new ListingDraftInputError();
    ids=row.ids.map(parseListingDraftId);if(new Set(ids).size!==ids.length)throw new ListingDraftInputError();
   }
   operation=action as string;
   const ip=getTrustedProxyIp(request.headers);if(!ip)throw new AuthRequestError(403,'UNTRUSTED_INGRESS');
   const token=readAccountSessionToken(request);if(!token)throw new AuthRequestError(401,'UNAUTHENTICATED');
   const {store,limiter}=await runtime();if(!await limiter.allowProduction('session',ip))throw new AuthRequestError(429,'RATE_LIMITED');
   if(!writing)return reply(await store.list(token,owner,cursor),200);
   await store.mark(token,owner,action,ids);return reply({ok:true},200);
  }catch(error){
   if(error instanceof AppSessionAccessError)error=new AuthRequestError(401,'UNAUTHENTICATED');
   if(error instanceof ListingDraftInputError)error=new AuthRequestError(422,'INVALID_INPUT');
   code=error instanceof AuthRequestError?error.code:'NOTIFICATIONS_UNAVAILABLE';const next=error instanceof AuthRequestError?error.status:503;
   return reply({error:{code}},next,next===429?{'Retry-After':'900'}:next===405?{Allow:'POST, PUT'}:undefined);
  }finally{audit({event:'notification_inbox_request',requestId,operation,status,durationMs:Date.now()-start,code});}
 };
}
