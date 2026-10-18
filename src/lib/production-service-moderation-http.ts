import {randomUUID} from 'node:crypto';import {authJson,readAuthJson,AuthRequestError,type AuthRateLimiter} from './auth-http';
import {readAccountSessionToken} from './account-cookie';import {getTrustedProxyIp} from './trusted-proxy-ip';
import {AppSessionAccessError} from './app-session-transaction';import {AdminAccessError} from './admin-authorization';
import {ServicePublicationAccessError,ServicePublicationConflictError} from './postgres-service-publications';
import {ListingDraftInputError,parseListingDraftId,parseListingDraftRevision,parseListingDraftCursor} from './listing-draft-contract.ts';
import {parseWorkReviewDecision,WorkModerationInputError} from './work-moderation-contract';import {productionMediaAdmission} from './production-media-http';
import type {ServicePublicationKind} from './service-publication-contract';import type {PostgresServiceModerationStore} from './postgres-service-moderation';
type Runtime={store:PostgresServiceModerationStore;limiter:Pick<AuthRateLimiter,'allowProduction'>};
type Event={event:'service_moderation';requestId:string;status:number;durationMs:number;code?:string};
export function createProductionServiceModerationHandler(config:{origin:string},mode:'owner'|'admin',runtime:()=>Runtime|Promise<Runtime>,audit:(event:Event)=>void=event=>console.info(JSON.stringify(event))){
 return async(request:Request)=>{
  const requestId=randomUUID(),start=Date.now();let status=503,code:string|undefined,slot=false;
  const reply=(body:unknown,next:number,headers?:Record<string,string>)=>{status=next;return authJson(body,next,{'X-Request-ID':requestId,...headers});};
  try{
   if(!['POST','PUT'].includes(request.method))throw new AuthRequestError(405,'METHOD_NOT_ALLOWED');
   const raw=await readAuthJson(request,config,2000,request.method==='PUT'?'PUT':'POST',4096);
   if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new AuthRequestError(422,'INVALID_INPUT');const row=raw as Record<string,unknown>;
   const action=mode==='owner'?(request.method==='PUT'?'submit':'read'):request.method==='PUT'?'decide':row.action;
   const keys=mode==='owner'?['expectedOwnerId','kind','publicationId','expectedRevision']:action==='list'?['expectedAdminId','kind','action','after']:
    action==='inspect'?['expectedAdminId','kind','action','requestId']:action==='photo'?['expectedAdminId','kind','action','requestId','fileId']:action==='decide'?['expectedAdminId','kind','requestId','state','note']:[];
   if(!keys.length||keys.length!==Object.keys(row).length||keys.some(key=>!Object.hasOwn(row,key))||!['specialist','fair','marquee'].some(kind=>kind===row.kind))throw new AuthRequestError(422,'INVALID_INPUT');
   const kind=row.kind as ServicePublicationKind,actor=parseListingDraftId(mode==='owner'?row.expectedOwnerId:row.expectedAdminId),id=action==='list'?null:parseListingDraftId(mode==='owner'?row.publicationId:row.requestId);
   const revision=mode==='owner'?parseListingDraftRevision(row.expectedRevision):null,cursor=action==='list'?parseListingDraftCursor(row.after):null,
    decision=action==='decide'?parseWorkReviewDecision(row.state,row.note):null,file=action==='photo'?parseListingDraftId(row.fileId):null;
   const ip=getTrustedProxyIp(request.headers);if(!ip)throw new AuthRequestError(403,'UNTRUSTED_INGRESS');const token=readAccountSessionToken(request);if(!token)throw new AuthRequestError(401,'UNAUTHENTICATED');
   const {store,limiter}=await runtime();if(!await limiter.allowProduction('session',ip))throw new AuthRequestError(429,'RATE_LIMITED');
   if(action==='read'||action==='submit')return reply(await store[action](token,actor,kind,id,revision),200);
   if(action==='list')return reply(await store.list(token,kind,cursor,actor),200);if(action==='inspect')return reply(await store.inspect(token,kind,id,actor),200);
   if(decision)return reply(await store.decide(token,kind,id,decision.state,decision.note,actor),200);
   if(productionMediaAdmission.reads>=4)throw new AuthRequestError(503,'MEDIA_BUSY');productionMediaAdmission.reads++;slot=true;
   const result=await store.readPhoto(token,kind,id,file,actor);if(result.record.mimeType!=='image/webp'||result.bytes.length!==result.record.size||result.bytes.length<12||result.bytes.length>2097152)throw Error('Invalid private image');
   status=200;const headers=new Headers(authJson({},200,{'X-Request-ID':requestId}).headers);headers.set('Content-Type','image/webp');headers.set('Content-Length',String(result.bytes.length));headers.set('Content-Disposition','inline; filename="photo.webp"');
   return new Response(new Uint8Array(result.bytes),{status,headers});
  }catch(error){
   if(error instanceof AppSessionAccessError)error=new AuthRequestError(401,'UNAUTHENTICATED');if(error instanceof AdminAccessError)error=new AuthRequestError(403,'ADMIN_REQUIRED');
   if(error instanceof ServicePublicationAccessError)error=new AuthRequestError(404,'PUBLICATION_NOT_FOUND');if(error instanceof ServicePublicationConflictError)error=new AuthRequestError(409,'PUBLICATION_CHANGED');
   if(error instanceof ListingDraftInputError||error instanceof WorkModerationInputError)error=new AuthRequestError(422,'INVALID_INPUT');
   code=error instanceof AuthRequestError?error.code:'SERVICE_MODERATION_UNAVAILABLE';const next=error instanceof AuthRequestError?error.status:503;
   return reply({error:{code}},next,next===429?{'Retry-After':'900'}:code==='MEDIA_BUSY'?{'Retry-After':'1'}:next===405?{Allow:'POST, PUT'}:undefined);
  }finally{if(slot)productionMediaAdmission.reads--;audit({event:'service_moderation',requestId,status,durationMs:Date.now()-start,code});}
 };
}
