import {randomUUID} from 'node:crypto';
import {authJson,readAuthJson,AuthRequestError,type AuthRateLimiter} from './auth-http';
import {readAccountSessionToken} from './account-cookie';
import {getTrustedProxyIp} from './trusted-proxy-ip';
import {AppSessionAccessError} from './app-session-transaction';
import {WorkPublicationAccessError,WorkPublicationConflictError,type PostgresWorkPublicationStore} from './postgres-work-publications';
import {WorkPublicationInputError,parseWorkPublicationForm,type WorkPublicationKind} from './work-publication-contract';
import {ListingDraftInputError,parseListingDraftId,parseListingDraftRevision,parseListingDraftCursor} from './listing-draft-contract';

type Runtime={store:Pick<PostgresWorkPublicationStore,'create'|'read'|'readIntent'|'list'|'update'>;limiter:Pick<AuthRateLimiter,'allowProduction'>};
type Event={event:'work_publication_request';requestId:string;operation:string;status:number;durationMs:number;code?:string};
const envelopes={list:['after'],read:['publicationId'],intent:['creationKey'],create:['creationKey','form'],update:['publicationId','expectedRevision','form']} as const;

export function createProductionWorkPublicationHandler(config:{origin:string},runtime:()=>Promise<Runtime>|Runtime,audit:(event:Event)=>void=event=>console.info(JSON.stringify(event))){
 return async(request:Request)=>{
  const requestId=randomUUID(),start=Date.now();let status=503,code:string|undefined,operation='invalid';
  const reply=(body:unknown,next:number,headers?:Record<string,string>)=>{status=next;return authJson(body,next,{'X-Request-ID':requestId,...headers});};
  try{
   if(!['POST','PUT'].includes(request.method))throw new AuthRequestError(405,'METHOD_NOT_ALLOWED');
   const writing=request.method==='PUT',raw=await readAuthJson(request,config,2000,writing?'PUT':'POST',writing?65536:4096);
   if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new AuthRequestError(422,'INVALID_INPUT');
   const row=raw as Record<string,unknown>,action=row.action;
   if(typeof action!=='string'||!Object.hasOwn(envelopes,action)||writing!==['create','update'].includes(action))throw new AuthRequestError(422,'INVALID_INPUT');
   const chosen=action as keyof typeof envelopes,keys=['action','kind','expectedOwnerId',...envelopes[chosen]];
   if(Object.keys(row).length!==keys.length||keys.some(key=>!Object.hasOwn(row,key))||(row.kind!=='vacancy'&&row.kind!=='workRequest'))throw new AuthRequestError(422,'INVALID_INPUT');
   operation=chosen;
   const owner=parseListingDraftId(row.expectedOwnerId),kind=row.kind as WorkPublicationKind;
   const id=chosen==='read'||chosen==='update'?parseListingDraftId(row.publicationId):null;
   const key=chosen==='intent'||chosen==='create'?parseListingDraftId(row.creationKey):null;
   const revision=chosen==='update'?parseListingDraftRevision(row.expectedRevision):null;
   const cursor=chosen==='list'?parseListingDraftCursor(row.after):null;
   const form=writing?parseWorkPublicationForm(kind,row.form):null;
   const ip=getTrustedProxyIp(request.headers);if(!ip)throw new AuthRequestError(403,'UNTRUSTED_INGRESS');
   const token=readAccountSessionToken(request);if(!token)throw new AuthRequestError(401,'UNAUTHENTICATED');
   const {store,limiter}=await runtime();if(!await limiter.allowProduction('session',ip))throw new AuthRequestError(429,'RATE_LIMITED');
   switch(chosen){
    case 'list':return reply(await store.list(token,owner,kind,cursor),200);
    case 'read':return reply(await store.read(token,owner,kind,id),200);
    case 'intent':return reply(await store.readIntent(token,owner,kind,key),200);
    case 'create':return reply(await store.create(token,owner,kind,key,form),200);
    case 'update':return reply(await store.update(token,owner,kind,id,revision,form),200);
   }
  }catch(error){
   if(error instanceof AppSessionAccessError)error=new AuthRequestError(401,'UNAUTHENTICATED');
   if(error instanceof WorkPublicationAccessError)error=new AuthRequestError(404,'PUBLICATION_NOT_FOUND');
   if(error instanceof WorkPublicationConflictError)error=new AuthRequestError(409,'PUBLICATION_CHANGED');
   if(error instanceof WorkPublicationInputError||error instanceof ListingDraftInputError)error=new AuthRequestError(422,'INVALID_INPUT');
   code=error instanceof AuthRequestError?error.code:'WORK_PUBLICATIONS_UNAVAILABLE';const next=error instanceof AuthRequestError?error.status:503;
   return reply({error:{code}},next,next===429?{'Retry-After':'900'}:next===405?{Allow:'POST, PUT'}:undefined);
  }finally{audit({event:'work_publication_request',requestId,operation,status,durationMs:Date.now()-start,code});}
 };
}
