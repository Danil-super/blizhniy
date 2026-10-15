"use client";
import {parseListingDraftId,parseListingDraftRevision} from './listing-draft-contract.ts';
import {parseListingPhotoIds,type ListingDraftPhotos} from './listing-photo-contract.ts';
import {parseMediaId,parseUploadedImage,mediaUploadTypes,normalizedImageByteLimit} from './media-upload-contract.ts';
import {maxListingImageFileSize} from './media-limits.ts';
const messages={UNKNOWN:'Результат не подтверждён. Проверьте сохранённые фотографии перед повтором.',
 UNAUTHENTICATED:'Войдите в аккаунт повторно.',SESSION_CHANGED:'Аккаунт изменился. Откройте черновик заново.',
 DRAFT_CHANGED:'Черновик изменён. Сверьте сохранённую версию.',DRAFT_NOT_FOUND:'Черновик недоступен.',
 INVALID_INPUT:'Проверьте файл. Допустимы JPEG, PNG, WebP и статичный GIF до 10 МБ.',
 MEDIA_IN_PROGRESS:'Файл обрабатывается или результат требует проверки. Не загружайте его повторно с новым идентификатором.',
 RATE_LIMITED:'Слишком много запросов. Попробуйте позже.',MEDIA_BUSY:'Обработчик занят. Повторите попытку позже.'};
export class ListingMediaClientError extends Error{
 readonly code:keyof typeof messages;
 constructor(code:keyof typeof messages){super(messages[code]);this.code=code;this.name='ListingMediaClientError';}
}
type Options={signal?:AbortSignal};
async function bytes(response:Response,signal:AbortSignal,limit:number){
 if(!response.body)throw new Error('Empty reply');
 const reader=response.body.getReader(),chunks:Uint8Array[]=[];let size=0,complete=false;
 try{for(;;){signal.throwIfAborted();const part=await reader.read();signal.throwIfAborted();if(part.done){complete=true;break;}
  size+=part.value.byteLength;if(size>limit)throw new Error('Reply too large');chunks.push(part.value);
 }const output=new Uint8Array(size);let offset=0;for(const chunk of chunks){output.set(chunk,offset);offset+=chunk.length;}return output;
 }finally{try{if(!complete)await reader.cancel();}finally{reader.releaseLock();}}
}
/** Cookie-only private transport. No identity cache, tokens, public URLs or implicit retries. */
export function createListingMediaClient(transport:typeof fetch){
 async function request(path:string,method:string,body:BodyInit,headers:Record<string,string>,options:Options={},binary=false):Promise<unknown>{
  try{
   options.signal?.throwIfAborted();const timeout=AbortSignal.timeout(60000),signal=options.signal?AbortSignal.any([timeout,options.signal]):timeout;
   const response=await transport(path,{method,body,headers:{'X-Blizhniy-Request':'1',...headers},credentials:'same-origin',cache:'no-store',redirect:'error',signal});
   if(response.status===200&&binary){
    if(response.headers.get('Content-Type')!=='image/webp')throw new Error('Unexpected image type');
    const result=await bytes(response,signal,normalizedImageByteLimit);if(result.length<12)throw new Error('Empty image');
    return new Blob([result],{type:'image/webp'});
   }
   const payload=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await bytes(response,signal,2097152)));
   if(response.status!==200){
    const code=payload?.error?.code;
    const statuses:Record<string,number>={UNAUTHENTICATED:401,SESSION_CHANGED:409,DRAFT_CHANGED:409,DRAFT_NOT_FOUND:404,MEDIA_IN_PROGRESS:409,RATE_LIMITED:429,MEDIA_BUSY:503};
    if(Object.hasOwn(statuses,code)&&statuses[code]===response.status)throw new ListingMediaClientError(code as keyof typeof messages);
    if([413,415,422].includes(response.status))throw new ListingMediaClientError('INVALID_INPUT');
    throw new ListingMediaClientError('UNKNOWN');
   }return payload;
  }catch(error){if(error instanceof ListingMediaClientError)throw error;throw new ListingMediaClientError('UNKNOWN');}
 }
 async function view(work:()=>Promise<unknown>,listingId:string):Promise<ListingDraftPhotos>{
  try{const value=await work() as ListingDraftPhotos;
   if(!value||Object.keys(value).sort().join()!=='id,photos,revision'||value.id!==parseListingDraftId(listingId)||!Array.isArray(value.photos)||value.photos.length>10000)throw new Error('Invalid reply');
   const photos=value.photos.map(parseUploadedImage);parseListingPhotoIds(photos.map(item=>item.id));
   return{id:value.id,revision:parseListingDraftRevision(value.revision),photos};
  }catch(error){if(error instanceof ListingMediaClientError)throw error;throw new ListingMediaClientError('UNKNOWN');}
 }
 const json={'Content-Type':'application/json'};
 return{
  async upload(owner:string,intent:string,file:Blob,options?:Options){
   try{if(file.size<1||file.size>maxListingImageFileSize||!mediaUploadTypes.some(type=>type===file.type))throw new ListingMediaClientError('INVALID_INPUT');
    return parseUploadedImage(await request('/api/account/media','POST',file,{'Content-Type':file.type,'X-Blizhniy-Owner':parseListingDraftId(owner),'X-Blizhniy-Intent':parseMediaId(intent)},options));
   }catch(error){if(error instanceof ListingMediaClientError)throw error;throw new ListingMediaClientError('UNKNOWN');}
  },
  photos:(owner:string,id:string,options?:Options)=>view(()=>request('/api/account/listing-photos','POST',JSON.stringify({expectedOwnerId:parseListingDraftId(owner),listingId:parseListingDraftId(id)}),json,options),id),
  replace:(owner:string,id:string,revision:string,photos:string[],options?:Options)=>view(()=>request('/api/account/listing-photos','PUT',JSON.stringify({expectedOwnerId:parseListingDraftId(owner),listingId:parseListingDraftId(id),expectedRevision:parseListingDraftRevision(revision),photoIds:parseListingPhotoIds(photos)}),json,options),id),
  async read(owner:string,fileId:string,options?:Options):Promise<Blob>{return await request('/api/account/media/read','POST',JSON.stringify({expectedOwnerId:parseListingDraftId(owner),fileId:parseMediaId(fileId)}),json,options,true) as Blob;},
 };
}
export const productionListingMedia=createListingMediaClient((...args)=>fetch(...args));
