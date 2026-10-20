import {parseListingFormDraft,type ListingFormDraft,type ListingFormSnapshot} from './listing-form-contract.ts';
import {mediaUploadTypes,type UploadedImage} from './media-upload-contract.ts';
import {maxListingImageFileSize,maxListingMediaTotalSize} from './media-limits.ts';
import {parseListingDraftId,parseListingDraftRevision} from './listing-draft-contract.ts';
type Options={signal?:AbortSignal};
type Dependencies={create:(owner:string,key:string,options?:Options)=>Promise<{id:string;revision:string}>;
 upload:(owner:string,intent:string,file:Blob,options?:Options)=>Promise<UploadedImage>;
 read:(owner:string,id:string,options?:Options)=>Promise<ListingFormSnapshot>;
 write:(owner:string,id:string,revision:string,form:ListingFormDraft,options?:Options)=>Promise<ListingFormSnapshot>};
export function sameListingForm(a:ListingFormDraft,b:ListingFormDraft):boolean{
 const canonical=(value:unknown):unknown=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?
  Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>[key,canonical(item)])):value;
 return JSON.stringify(canonical(a))===JSON.stringify(canonical(b));
}
/** One owner-scoped in-memory intent. Never silently repeats a full-form write after an unknown reply. */
export function createListingFormSave(owner:string,input:unknown,files:Blob[],dependencies:Dependencies,existing?:ListingFormSnapshot){
 const form=structuredClone(parseListingFormDraft(input));
 if(form.photoIds.some(id=>!existing?.form.photoIds.includes(id))||files.reduce((sum,file)=>sum+file.size,0)+(existing?.photos.filter(photo=>form.photoIds.includes(photo.id)).reduce((sum,photo)=>sum+photo.size,0)??0)>maxListingMediaTotalSize||files.some(file=>file.size<1||file.size>maxListingImageFileSize||!mediaUploadTypes.some(type=>type===file.type)))throw new Error('Выберите JPEG, PNG, WebP или статичный GIF до 10 МБ; общий объём до 160 МБ.');
 const creationKey=crypto.randomUUID(),uploads=files.map(file=>({file,intent:crypto.randomUUID(),ready:null as UploadedImage|null}));
 let created:{id:string;revision:string}|null=existing?{id:parseListingDraftId(existing.id),revision:parseListingDraftRevision(existing.revision)}:null,unknown=false,remote:ListingFormSnapshot|null=null,busy=false,complete:ListingFormSnapshot|null=null;
 const payload=()=>({...form,photoIds:[...form.photoIds,...uploads.map(item=>{if(!item.ready)throw new Error('Загрузка не подтверждена.');return item.ready.id;})]});
 return{
  get id(){return created?.id??null;},get uncertain(){return unknown;},get completed(){return complete;},
  async save(options?:Options){
   if(busy||unknown)throw new Error('Сначала проверьте сохранённую версию.');if(complete)return complete;busy=true;
   try{
    created??=await dependencies.create(owner,creationKey,options);
    if(!existing&&created.revision!=='1'&&!remote){unknown=true;throw new Error('Создание уже выполнялось. Сверьте сохранённую версию.');}
    for(const item of uploads)item.ready??=await dependencies.upload(owner,item.intent,item.file,options);
    unknown=true;const saved=await dependencies.write(owner,created.id,created.revision,payload(),options);
    if(!sameListingForm(saved.form,payload()))throw new Error('Сохранённая версия отличается. Проверьте результат.');
    complete=saved;unknown=false;return complete;
   }finally{busy=false;}
  },
  async readback(options?:Options){
   if(busy||!created)throw new Error('Дождитесь завершения запроса.');busy=true;
   try{remote=await dependencies.read(owner,created.id,options);
    if(uploads.every(item=>item.ready)&&sameListingForm(remote.form,payload())){complete=remote;unknown=false;}return remote;
   }finally{busy=false;}
  },
  acceptRemoteRevision(){if(busy||!remote||!created)throw new Error('Сначала прочитайте сохранённую версию.');created.revision=remote.revision;unknown=false;},
 };
}
