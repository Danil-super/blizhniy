import {parseServicePublicationForm,ServicePublicationInputError,type ServicePublicationKind,type ServicePublicationForm} from './service-publication-contract.ts';
import {parseListingDraftId,parseListingDraftRevision} from './listing-draft-contract.ts';
import {mediaUploadTypes,type UploadedImage} from './media-upload-contract.ts';import {maxListingImageFileSize,maxListingMediaTotalSize} from './media-limits.ts';
import type {ServicePublicationSnapshot} from './postgres-service-publications';
import {ServiceClientError} from './client-service-publications.ts';
type Options={signal?:AbortSignal};
type Dependencies={upload:(owner:string,intent:string,file:Blob,options?:Options)=>Promise<UploadedImage>;
 create:(owner:string,kind:ServicePublicationKind,key:string,form:ServicePublicationForm,options?:Options)=>Promise<ServicePublicationSnapshot>;
 update:(owner:string,kind:ServicePublicationKind,id:string,revision:string,form:ServicePublicationForm,options?:Options)=>Promise<ServicePublicationSnapshot>;
 read:(owner:string,kind:ServicePublicationKind,id:string,options?:Options)=>Promise<ServicePublicationSnapshot>;
 intent:(owner:string,kind:ServicePublicationKind,key:string,options?:Options)=>Promise<ServicePublicationSnapshot|null>};
/** Captures one owner/form/files intent. Unknown mutations can only be followed by explicit readback. */
export function createServicePublicationSave(owner:string,kind:ServicePublicationKind,input:unknown,files:Blob[],dependencies:Dependencies,initial?:ServicePublicationSnapshot){
 parseListingDraftId(owner);const form=structuredClone(parseServicePublicationForm(kind,input)),ids=form.kind==='marquee'?[]:form.photoIds;
 if(initial){parseListingDraftId(initial.id);parseListingDraftRevision(initial.revision);if(initial.kind!==kind)throw new ServicePublicationInputError();}
 const max=kind==='specialist'?12:kind==='fair'?10:0;
 if(ids.length+files.length>max||files.reduce((sum,file)=>sum+file.size,0)>maxListingMediaTotalSize||files.some(file=>file.size<1||file.size>maxListingImageFileSize||!mediaUploadTypes.some(type=>type===file.type)))throw Error('Выберите допустимые изображения до 10 МБ каждое.');
 const creationKey=crypto.randomUUID(),uploads=files.map(file=>({file,intent:crypto.randomUUID(),ready:null as UploadedImage|null}));
 let base=initial??null,remote:ServicePublicationSnapshot|null=null,unknown=false,busy=false,complete:ServicePublicationSnapshot|null=null;
 const payload=()=>form.kind==='marquee'?form:parseServicePublicationForm(kind,{...form,photoIds:[...ids,...uploads.map(item=>{if(!item.ready)throw Error('Загрузка не подтверждена.');return item.ready.id;})]});
 const matches=(row:ServicePublicationSnapshot)=>uploads.every(item=>item.ready)&&JSON.stringify(parseServicePublicationForm(kind,row.form))===JSON.stringify(payload());
 return{
  get uncertain(){return unknown;},get completed(){return complete;},
  async save(options?:Options){if(busy||unknown)throw Error('Сначала проверьте сохранённую версию.');if(complete)return complete;busy=true;
   try{for(const item of uploads)item.ready??=await dependencies.upload(owner,item.intent,item.file,options);
    unknown=true;const row=base?await dependencies.update(owner,kind,base.id,base.revision,payload(),options):await dependencies.create(owner,kind,creationKey,payload(),options);
    if(!matches(row))throw Error('Сохранена другая версия. Проверьте результат.');complete=row;unknown=false;return row;
   }catch(error){if(error instanceof ServiceClientError&&error.code==='INVALID_INPUT')unknown=false;throw error;}
   finally{busy=false;}
  },
  async readback(options?:Options){if(busy)throw Error('Дождитесь завершения запроса.');busy=true;
   try{remote=base?await dependencies.read(owner,kind,base.id,options):await dependencies.intent(owner,kind,creationKey,options);
    if(!remote){unknown=false;return null;}if(matches(remote)){complete=remote;unknown=false;}return remote;
   }finally{busy=false;}
  },
  acceptRemoteRevision(){if(busy||!remote)throw Error('Сначала прочитайте сохранённую версию.');base=remote;unknown=false;},
 };
}
export function readServicePublicationFormData(kind:ServicePublicationKind,data:FormData){
 const read=(name:string)=>String(data.get(name)??'').trim(),placementRightConfirmed=['1','on'].includes(read('placementRightConfirmed'));
 if(kind==='marquee')return parseServicePublicationForm(kind,{title:read('title'),href:read('href')||null,placementRightConfirmed});
 const exact=read('locationMode')==='exact'&&read('mapPointSelected')==='1';
 const coordinate=(name:string)=>{const value=read(name);if(!value)throw new ServicePublicationInputError();return Number(value.replace(',','.'));};
 const common={kind,title:read('title'),description:String(data.get('description')??''),cityName:read('city').split(',')[0].trim()||null,district:read('district')||null,
  address:exact?read('address')||null:null,latitude:exact?coordinate('lat'):null,longitude:exact?coordinate('lng'):null,showExactAddress:exact,
  contactPhone:read('phone')||null,email:read('email')||null,messengerUrl:read('messengerUrl')||null,videoUrl:read('videoUrl')||null,
  photoIds:data.getAll('keepPhotoIds').map(String),placementRightConfirmed};
 return parseServicePublicationForm(kind,kind==='specialist'?{...common,professionName:read('profession')||null,price:read('price').replace(/\s/g,'').replace(',','.')||null,
  skills:read('skills')||null,experience:read('experience')||null}:{...common,category:read('category')||null,comment:read('comment')||null});
}
