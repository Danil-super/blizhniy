import {randomUUID} from 'node:crypto';
import {authJson,AuthRequestError} from './auth-http';
import {getTrustedProxyIp} from './trusted-proxy-ip';
import {parseListingDraftId,ListingDraftInputError} from './listing-draft-contract.ts';
import {productionMediaAdmission} from './production-media-http';
import type {PostgresPublicWorkStore} from './postgres-public-work';
import type {MediaFileRecord} from './media-files';
type Runtime={store:Pick<PostgresPublicWorkStore,'photoRecord'>;files:{read(record:MediaFileRecord):Promise<Buffer>}};
type Event={event:'public_work_photo';requestId:string;status:number;durationMs:number;code?:string};

/** Public only after current SQL authorization; the underlying file directory stays private. */
export function createProductionPublicWorkPhotoHandler(config:{origin:string},runtime:()=>Runtime|Promise<Runtime>,audit:(event:Event)=>void=event=>console.info(JSON.stringify(event))){
 return async(request:Request,publicationId:unknown,fileId:unknown):Promise<Response>=>{
  const requestId=randomUUID(),start=Date.now();let status=503,code:string|undefined,slot=false;
  const reply=(next:number,reason:string)=>{status=next;code=reason;return authJson({error:{code}},next,{'X-Request-ID':requestId,...(reason==='MEDIA_BUSY'?{'Retry-After':'1'}:{}),...(next===405?{Allow:'GET'}:{})});};
  try{
   if(request.method!=='GET')throw new AuthRequestError(405,'METHOD_NOT_ALLOWED');
   if(request.headers.get('host')!==new URL(config.origin).host)throw new AuthRequestError(403,'FORBIDDEN_TARGET');
   if(new URL(request.url).search)throw new AuthRequestError(400,'QUERY_NOT_ALLOWED');
   if(!getTrustedProxyIp(request.headers))throw new AuthRequestError(403,'UNTRUSTED_INGRESS');
   const id=parseListingDraftId(publicationId),file=parseListingDraftId(fileId);
   if(productionMediaAdmission.reads>=4)throw new AuthRequestError(503,'MEDIA_BUSY');
   productionMediaAdmission.reads++;slot=true;
   request.signal.throwIfAborted();const {store,files}=await runtime(),access=await store.photoRecord(id,file);
   if(!access)throw new AuthRequestError(404,'MEDIA_NOT_FOUND');
   const revision=access.revision,record={...access.record};
   if(Date.parse(access.expiresAt)<=Date.now())throw new AuthRequestError(404,'MEDIA_NOT_FOUND');
   const bytes=await files.read(record);request.signal.throwIfAborted();
   if(record.mimeType!=='image/webp'||bytes.length!==record.size||bytes.length<12||bytes.length>2097152)throw Error('Invalid public image');
   const current=await store.photoRecord(id,file);request.signal.throwIfAborted();
   if(!current||current.revision!==revision||Date.parse(current.expiresAt)<=Date.now()||
    Object.keys(record).some(key=>record[key as keyof MediaFileRecord]!==current.record[key as keyof MediaFileRecord]))throw new AuthRequestError(404,'MEDIA_NOT_FOUND');
   status=200;const headers=new Headers(authJson({},200,{'X-Request-ID':requestId}).headers);
   headers.set('Content-Type','image/webp');headers.set('Content-Length',String(bytes.length));headers.set('Content-Disposition','inline; filename="photo.webp"');
   return new Response(new Uint8Array(bytes),{status,headers});
  }catch(error){
   if(error instanceof ListingDraftInputError)return reply(404,'MEDIA_NOT_FOUND');
   return reply(error instanceof AuthRequestError?error.status:503,error instanceof AuthRequestError?error.code:'MEDIA_UNAVAILABLE');
  }finally{if(slot)productionMediaAdmission.reads--;audit({event:'public_work_photo',requestId,status,durationMs:Date.now()-start,code});}
 };
}
