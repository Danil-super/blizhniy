import {randomUUID} from 'node:crypto';
import {authJson,readAuthJson,AuthRequestError,type AuthRateLimiter} from './auth-http';
import {readAccountSessionToken} from './account-cookie';import {getTrustedProxyIp} from './trusted-proxy-ip';
import {AdminAccessError} from './admin-authorization';
import {ListingDraftAccessError,ListingDraftConflictError} from './postgres-listing-drafts';
import {ListingDraftInputError,parseListingDraftId} from './listing-draft-contract.ts';
import {ListingModerationInputError,parseModerationDecision,type PostgresListingModerationStore} from './postgres-listing-moderation';
import {productionMediaAdmission} from './production-media-http';
import {normalizedImageByteLimit} from './media-upload-contract.ts';
type Runtime={store:Pick<PostgresListingModerationStore,'list'|'inspect'|'decide'|'readPhoto'>;limiter:Pick<AuthRateLimiter,'allowProduction'>;
 identity:{resolveSession(token:string):Promise<{id:string;role:string}|null>}};
type Event={event:'admin_listing_moderation';requestId:string;status:number;durationMs:number;code?:string};
export function createAdminListingModerationHandler(config:{origin:string},runtime:()=>Promise<Runtime>|Runtime,audit:(event:Event)=>void=event=>console.info(JSON.stringify(event))){
 return async(request:Request)=>{
  const requestId=randomUUID(),started=Date.now();let status=503,code:string|undefined,photoSlot=false;
  const reply=(body:unknown,next:number,headers?:Record<string,string>)=>{status=next;return authJson(body,next,{'X-Request-ID':requestId,...headers});};
  try{
   if(request.method!=='POST'&&request.method!=='PUT')throw new AuthRequestError(405,'METHOD_NOT_ALLOWED');
   const raw=await readAuthJson(request,config,2000,request.method,8192);
   if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new AuthRequestError(422,'INVALID_INPUT');
   const row=raw as Record<string,unknown>,action=request.method==='PUT'?'decide':row.action;
   const keys=action==='list'?['action','expectedAdminId','after']:action==='inspect'?['action','expectedAdminId','requestId']:
    action==='photo'?['action','expectedAdminId','requestId','fileId']:action==='decide'?['expectedAdminId','requestId','state','note']:[];
   if(!keys.length||Object.keys(row).length!==keys.length||keys.some(key=>!Object.hasOwn(row,key)))throw new AuthRequestError(422,'INVALID_INPUT');
   const admin=parseListingDraftId(row.expectedAdminId),id=action==='list'?null:parseListingDraftId(row.requestId);
   const cursor=action==='list'&&row.after!==null?parseListingDraftId(row.after):null;
   const decision=action==='decide'?parseModerationDecision(row.state,row.note):null;
   const file=action==='photo'?parseListingDraftId(row.fileId):null,ip=getTrustedProxyIp(request.headers);
   if(!ip)throw new AuthRequestError(403,'UNTRUSTED_INGRESS');const token=readAccountSessionToken(request);if(!token)throw new AuthRequestError(401,'UNAUTHENTICATED');
   const state=await runtime();if(!await state.limiter.allowProduction('session',ip))throw new AuthRequestError(429,'RATE_LIMITED');
   if(action==='list')return reply(await state.store.list(token,cursor,admin),200);
   if(action==='inspect')return reply(await state.store.inspect(token,id,admin),200);
   if(decision)return reply(await state.store.decide(token,id,decision.state,decision.note,admin),200);
   // This admission pre-check is not authority: readPhoto rechecks role/session/revision inside its transaction.
   const principal=await state.identity.resolveSession(token);if(!principal)throw new AuthRequestError(401,'UNAUTHENTICATED');
   if(principal.role!=='admin'||principal.id!==admin)throw new AdminAccessError();
   if(productionMediaAdmission.reads>=4)throw new AuthRequestError(503,'MEDIA_BUSY');productionMediaAdmission.reads++;photoSlot=true;
   const result=await state.store.readPhoto(token,id,file,admin);
   if(result.record.mimeType!=='image/webp'||result.bytes.length!==result.record.size||result.bytes.length<12||result.bytes.length>normalizedImageByteLimit)throw new Error('Invalid private image reply');
   status=200;const headers=new Headers(authJson({},200,{'X-Request-ID':requestId}).headers);
   headers.set('Content-Type','image/webp');headers.set('Content-Length',String(result.bytes.length));headers.set('Content-Disposition','inline; filename="photo.webp"');
   return new Response(new Uint8Array(result.bytes),{status,headers});
  }catch(error){
   if(error instanceof AdminAccessError)error=new AuthRequestError(403,'ADMIN_REQUIRED');
   if(error instanceof ListingDraftAccessError)error=new AuthRequestError(404,'DRAFT_NOT_FOUND');
   if(error instanceof ListingDraftConflictError)error=new AuthRequestError(409,'DRAFT_CHANGED');
   if(error instanceof ListingDraftInputError||error instanceof ListingModerationInputError)error=new AuthRequestError(422,'INVALID_INPUT');
   code=error instanceof AuthRequestError?error.code:'MODERATION_UNAVAILABLE';const next=error instanceof AuthRequestError?error.status:503;
   return reply({error:{code}},next,next===429?{'Retry-After':'900'}:code==='MEDIA_BUSY'?{'Retry-After':'1'}:next===405?{Allow:'POST, PUT'}:undefined);
  }finally{if(photoSlot)productionMediaAdmission.reads--;audit({event:'admin_listing_moderation',requestId,status,durationMs:Date.now()-started,code});}
 };
}
