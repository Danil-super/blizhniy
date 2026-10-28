import {randomUUID} from 'node:crypto';
import {authJson,readAuthJson,AuthRequestError,type AuthRateLimiter} from './auth-http';
import {readAccountSessionToken} from './account-cookie';
import {getTrustedProxyIp} from './trusted-proxy-ip';
import {AppSessionAccessError} from './app-session-transaction';
import {WorkPublicationAccessError} from './postgres-work-publications';
import {ListingDraftInputError,parseListingDraftId,parseListingDraftCursor} from './listing-draft-contract.ts';
import type {PostgresWorkCabinetStore} from './postgres-work-cabinet';
type Runtime={store:Pick<PostgresWorkCabinetStore,'list'>;limiter:Pick<AuthRateLimiter,'allowProduction'>};
type Event={event:'work_cabinet_read';requestId:string;status:number;durationMs:number;code?:string};

export function createWorkCabinetHandler(config:{origin:string},runtime:()=>Promise<Runtime>|Runtime,audit:(event:Event)=>void=event=>console.info(JSON.stringify(event))){
 return async(request:Request)=>{
  const requestId=randomUUID(),start=Date.now();let status=503,code:string|undefined;
  const reply=(body:unknown,next:number,headers?:Record<string,string>)=>{status=next;return authJson(body,next,{'X-Request-ID':requestId,...headers});};
  try{
   if(request.method!=='POST')throw new AuthRequestError(405,'METHOD_NOT_ALLOWED');
   const raw=await readAuthJson(request,config,2000,'POST',4096);
   if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new AuthRequestError(422,'INVALID_INPUT');
   const row=raw as Record<string,unknown>,keys=['kind','expectedOwnerId','after'];
   if(Object.keys(row).length!==keys.length||keys.some(key=>!Object.hasOwn(row,key))||(row.kind!=='vacancy'&&row.kind!=='workRequest'))throw new AuthRequestError(422,'INVALID_INPUT');
   const owner=parseListingDraftId(row.expectedOwnerId),cursor=parseListingDraftCursor(row.after);
   const ip=getTrustedProxyIp(request.headers);if(!ip)throw new AuthRequestError(403,'UNTRUSTED_INGRESS');
   const token=readAccountSessionToken(request);if(!token)throw new AuthRequestError(401,'UNAUTHENTICATED');
   const {store,limiter}=await runtime();if(!await limiter.allowProduction('session',ip))throw new AuthRequestError(429,'RATE_LIMITED');
   return reply(await store.list(token,owner,row.kind,cursor),200);
  }catch(error){
   if(error instanceof AppSessionAccessError)error=new AuthRequestError(401,'UNAUTHENTICATED');
   if(error instanceof WorkPublicationAccessError)error=new AuthRequestError(404,'PUBLICATION_NOT_FOUND');
   if(error instanceof ListingDraftInputError)error=new AuthRequestError(422,'INVALID_INPUT');
   code=error instanceof AuthRequestError?error.code:'WORK_PUBLICATIONS_UNAVAILABLE';const next=error instanceof AuthRequestError?error.status:503;
   return reply({error:{code}},next,next===429?{'Retry-After':'900'}:next===405?{Allow:'POST'}:undefined);
  }finally{audit({event:'work_cabinet_read',requestId,status,durationMs:Date.now()-start,code});}
 };
}
