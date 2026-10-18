import {parseWorkPublicationForm,type WorkPublicationKind,type WorkPublicationForm} from './work-publication-contract.ts';
import {parseListingDraftId,parseListingDraftRevision} from './listing-draft-contract.ts';
import {mediaUploadTypes,type UploadedImage} from './media-upload-contract.ts';
import {maxListingImageFileSize,maxListingMediaTotalSize} from './media-limits.ts';
import type {WorkPublicationSnapshot} from './postgres-work-publications';
type Options={signal?:AbortSignal};
type Dependencies={upload:(owner:string,intent:string,file:Blob,options?:Options)=>Promise<UploadedImage>;
 create:(owner:string,kind:WorkPublicationKind,key:string,form:WorkPublicationForm,options?:Options)=>Promise<WorkPublicationSnapshot>;
 update:(owner:string,kind:WorkPublicationKind,id:string,revision:string,form:WorkPublicationForm,options?:Options)=>Promise<WorkPublicationSnapshot>;
 read:(owner:string,kind:WorkPublicationKind,id:string,options?:Options)=>Promise<WorkPublicationSnapshot>;
 intent:(owner:string,kind:WorkPublicationKind,key:string,options?:Options)=>Promise<WorkPublicationSnapshot|null>};

/** A captured owner-scoped intent; an uncertain write can only be followed by a read. */
export function createWorkPublicationSave(owner:string,kind:WorkPublicationKind,input:unknown,files:Blob[],dependencies:Dependencies,initial?:WorkPublicationSnapshot){
 parseListingDraftId(owner);const form=structuredClone(parseWorkPublicationForm(kind,input));
 if(initial){parseListingDraftId(initial.id);parseListingDraftRevision(initial.revision);if(initial.kind!==kind)throw Error('Несовместимая публикация.');}
 if(form.photoIds.length+files.length>(kind==='vacancy'?20:6)||files.reduce((sum,file)=>sum+file.size,0)>maxListingMediaTotalSize||files.some(file=>file.size<1||file.size>maxListingImageFileSize||!mediaUploadTypes.some(type=>type===file.type)))throw Error('Выберите допустимые изображения до 10 МБ каждое.');
 const creationKey=crypto.randomUUID(),uploads=files.map(file=>({file,intent:crypto.randomUUID(),ready:null as UploadedImage|null}));
 let base=initial??null,remote:WorkPublicationSnapshot|null=null,unknown=false,busy=false,complete:WorkPublicationSnapshot|null=null;
 const payload=()=>parseWorkPublicationForm(kind,{...form,photoIds:[...form.photoIds,...uploads.map(item=>{if(!item.ready)throw Error('Загрузка не подтверждена.');return item.ready.id;})]});
 const matches=(value:WorkPublicationSnapshot)=>uploads.every(item=>item.ready)&&JSON.stringify(parseWorkPublicationForm(kind,value.form))===JSON.stringify(payload());
 return{
  get uncertain(){return unknown;},get completed(){return complete;},
  async save(options?:Options){
   if(busy||unknown)throw Error('Сначала проверьте сохранённую версию.');if(complete)return complete;busy=true;
   try{
    for(const item of uploads)item.ready??=await dependencies.upload(owner,item.intent,item.file,options);
    unknown=true;const result=base?await dependencies.update(owner,kind,base.id,base.revision,payload(),options):await dependencies.create(owner,kind,creationKey,payload(),options);
    if(!matches(result))throw Error('Сохранена другая версия. Проверьте результат.');complete=result;unknown=false;return complete;
   }finally{busy=false;}
  },
  async readback(options?:Options){
   if(busy)throw Error('Дождитесь завершения запроса.');busy=true;
   try{remote=base?await dependencies.read(owner,kind,base.id,options):await dependencies.intent(owner,kind,creationKey,options);
    if(!remote){unknown=false;return null;}if(matches(remote)){complete=remote;unknown=false;}return remote;
   }finally{busy=false;}
  },
  acceptRemoteRevision(){if(busy||!remote)throw Error('Сначала прочитайте сохранённую версию.');base=remote;unknown=false;},
 };
}
