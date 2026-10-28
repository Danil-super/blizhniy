import {randomUUID} from 'node:crypto';
import {authJson,readAuthJson,AuthRequestError,type AuthRateLimiter} from './auth-http';
import {readAccountSessionToken} from './account-cookie';
import {getTrustedProxyIp} from './trusted-proxy-ip';
import {AdminAccessError} from './admin-authorization';
import {ListingDraftInputError,parseListingDraftId,parseListingDraftRevision} from './listing-draft-contract.ts';
import {ListingBlockInputError,parseListingBlockReason,ListingManagementNotFoundError,ListingManagementConflictError} from './listing-block-contract.ts';
import type {PostgresListingManagementStore} from './postgres-listing-management';
import {productionMediaAdmission} from './production-media-http';
import {normalizedImageByteLimit} from './media-upload-contract.ts';
type Runtime={store:Pick<PostgresListingManagementStore,'list'|'inspect'|'block'|'readPhoto'>;limiter:Pick<AuthRateLimiter,'allowProduction'>};
type Event={event:'admin_listing_management';requestId:string;status:number;durationMs:number;code?:string};
export function createAdminListingManagementHandler(config:{origin:string},runtime:()=>Promise<Runtime>|Runtime,audit:(event:Event)=>void=event=>console.info(JSON.stringify(event))){
 return async(request:Request)=>{
  const requestId=randomUUID(),started=Date.now();let status=503,code:string|undefined,photoSlot=false;
  const reply=(body:unknown,next:number,headers?:Record<string,string>)=>{status=next;return authJson(body,next,{'X-Request-ID':requestId,...headers});};
  try{
   const raw=await readAuthJson(request,config,2000,'POST',8192);
   if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new AuthRequestError(422,'INVALID_INPUT');const row=raw as Record<string,unknown>,action=row.action;
   const keys=action==='list'?['action','expectedAdminId','after']:action==='inspect'?['action','expectedAdminId','listingId']:action==='block'?['action','expectedAdminId','listingId','expectedRevision','reason']:action==='photo'?['action','expectedAdminId','listingId','fileId']:[];
   if(!keys.length||Object.keys(row).length!==keys.length||keys.some(key=>!Object.hasOwn(row,key)))throw new AuthRequestError(422,'INVALID_INPUT');
   const actor=parseListingDraftId(row.expectedAdminId),id=action==='list'?null:parseListingDraftId(row.listingId),after=action==='list'&&row.after!==null?parseListingDraftId(row.after):null;
   const revision=action==='block'?parseListingDraftRevision(row.expectedRevision):null,reason=action==='block'?parseListingBlockReason(row.reason):null,file=action==='photo'?parseListingDraftId(row.fileId):null;
   const ip=getTrustedProxyIp(request.headers);if(!ip)throw new AuthRequestError(403,'UNTRUSTED_INGRESS');
   const token=readAccountSessionToken(request);if(!token)throw new AuthRequestError(401,'UNAUTHENTICATED');
   const state=await runtime();if(!await state.limiter.allowProduction('session',ip))throw new AuthRequestError(429,'RATE_LIMITED');
   if(action==='list')return reply(await state.store.list(token,actor,after),200);
   if(action==='inspect')return reply(await state.store.inspect(token,actor,id),200);
   if(action==='block')return reply(await state.store.block(token,actor,id,revision,reason),200);
   if(productionMediaAdmission.reads>=4)throw new AuthRequestError(503,'MEDIA_BUSY');productionMediaAdmission.reads++;photoSlot=true;
   const result=await state.store.readPhoto(token,actor,id,file);
   if(result.record.mimeType!=='image/webp'||result.bytes.length!==result.record.size||result.bytes.length<12||result.bytes.length>normalizedImageByteLimit)throw Error('Invalid private image');
   status=200;const headers=new Headers(authJson({},200,{'X-Request-ID':requestId}).headers);headers.set('Content-Type','image/webp');headers.set('Content-Length',String(result.bytes.length));headers.set('Content-Disposition','inline; filename="photo.webp"');
   return new Response(new Uint8Array(result.bytes),{status,headers});
  }catch(error){
   if(error instanceof AdminAccessError)error=new AuthRequestError(403,'ADMIN_REQUIRED');
   if(error instanceof ListingManagementNotFoundError)error=new AuthRequestError(404,'LISTING_NOT_FOUND');
   if(error instanceof ListingManagementConflictError)error=new AuthRequestError(409,'LISTING_CHANGED');
   if(error instanceof ListingDraftInputError||error instanceof ListingBlockInputError)error=new AuthRequestError(422,'INVALID_INPUT');
   code=error instanceof AuthRequestError?error.code:'MANAGEMENT_UNAVAILABLE';const next=error instanceof AuthRequestError?error.status:503;
   return reply({error:{code}},next,next===429?{'Retry-After':'900'}:code==='MEDIA_BUSY'?{'Retry-After':'1'}:next===405?{Allow:'POST'}:undefined);
  }finally{if(photoSlot)productionMediaAdmission.reads--;audit({event:'admin_listing_management',requestId,status,durationMs:Date.now()-started,code});}
 };
}
