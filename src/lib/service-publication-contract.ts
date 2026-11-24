import {parseListingFormDraft} from './listing-form-contract.ts';
import {fairCategories} from './data.ts';
import {validPlainText,validEmail,validWebUrl,validProfileName} from './cabinet-field-validation.ts';
import {parseListingDraftId} from './listing-draft-contract.ts';
export const servicePublicationStatuses = ['draft','pending_payment','paid','published','archived','expired','rejected'] as const;
export type ServicePublicationKind='specialist'|'fair'|'marquee';
type Consent={title:string;placementRightConfirmed:boolean};
type Details=Consent&{description:string;cityName:string|null;district:string|null;address:string|null;latitude:number|null;longitude:number|null;
 showExactAddress:boolean;contactPhone:string|null;email:string|null;messengerUrl:string|null;photoIds:string[];videoUrl:string|null};
export type ServicePublicationForm=(Details&{kind:'specialist';professionName:string|null;professionId?:string;price:string|null;skills:string|null;experience:string|null})|
 (Details&{kind:'fair';category:string|null;comment:string|null})|(Consent&{kind:'marquee';href:string|null});
export class ServicePublicationInputError extends Error{constructor(){super('Invalid service publication');}}
const invalid=():never=>{throw new ServicePublicationInputError();};
const detailKeys=['description','cityName','district','address','latitude','longitude','showExactAddress','contactPhone','email','messengerUrl','photoIds','videoUrl'];
function text(value:unknown,max:number,multiline=false):string|null{
 if(value===undefined||value===null||value==='')return null;
 if(typeof value!=='string'||value.length>max||!validPlainText(value,multiline))return invalid();
 return value.trim()||null;
}
function url(value:unknown){const result=text(value,500);if(!result)return null;
 if(!validWebUrl(result))return invalid();return new URL(result).toString();}
/** Three actual service domains, with explicit independent field allowlists. Never identity/status/payment input. */
export function parseServicePublicationForm(kind:ServicePublicationKind,value:unknown):ServicePublicationForm{
 try{
  if(!['specialist','fair','marquee'].includes(kind)||!value||typeof value!=='object'||Array.isArray(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value)))return invalid();
  const row=value as Record<string,unknown>,allowed=['kind','title','placementRightConfirmed',...(kind==='marquee'?['href']:[...detailKeys,...(kind==='specialist'?['professionName','professionId','price','skills','experience']:['category','comment'])])];
  if(Reflect.ownKeys(row).some(key=>typeof key!=='string'||!allowed.includes(key))||row.kind!==undefined&&row.kind!==kind)return invalid();
  const placementRightConfirmed=Object.hasOwn(row,'placementRightConfirmed')?row.placementRightConfirmed:false;
  if(typeof placementRightConfirmed!=='boolean')return invalid();
  const title=text(row.title,kind==='marquee'?140:160)??'';
  if(kind==='marquee')return{kind,title,placementRightConfirmed,href:url(row.href)};
  const core=parseListingFormDraft({kind:'prodam',title,description:row.description??'',price:kind==='specialist'?row.price??null:null,
   cityName:row.cityName,district:row.district,address:row.address,latitude:row.latitude,longitude:row.longitude,showExactAddress:row.showExactAddress,
   contactPhone:row.contactPhone,messengerUrl:row.messengerUrl,photoIds:row.photoIds});
  if(core.description.length>3000||core.photoIds.length>(kind==='specialist'?12:10))return invalid();
  const email=text(row.email,254);if(!validEmail(email??''))return invalid();
  const details:Details={title,placementRightConfirmed,description:core.description,cityName:core.cityName,district:core.district,address:core.address,
   latitude:core.latitude,longitude:core.longitude,showExactAddress:core.showExactAddress,contactPhone:core.contactPhone,messengerUrl:core.messengerUrl,
   email,photoIds:core.photoIds,videoUrl:url(row.videoUrl)};
  return kind==='specialist'?{kind,...details,professionName:text(row.professionName,200),price:core.price,skills:text(row.skills,500,true),experience:text(row.experience,500,true),
   ...(Object.hasOwn(row,'professionId')?{professionId:parseListingDraftId(row.professionId)}:{})}:
   {kind,...details,category:text(row.category,160),comment:text(row.comment,1000,true)};
 }catch{return invalid();}
}
export function checkServicePublicationForm(form:ServicePublicationForm):string[]{
 const issues:string[]=[];
 const title=form.title.trim();
 if(title.length<(form.kind==='marquee'?10:2)&&!(form.kind==='specialist'&&validProfileName(title)))
  issues.push(form.kind==='marquee'?'Введите рекламный текст от 10 до 140 символов.':form.kind==='specialist'?'Укажите имя специалиста.':'Укажите имя или название от 2 символов.');
 if(!form.placementRightConfirmed)issues.push('Подтвердите право размещать публикацию, фотографии и контактные данные.');
 if(form.kind==='marquee')return issues;
 if(form.description.trim().length<(form.kind==='specialist'?20:1)||form.description.length>3000)issues.push('Добавьте содержательное описание до 3000 символов.');
 if(!form.cityName)issues.push('Выберите город.');
 if(form.email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email))issues.push('Проверьте контактный email.');
 const phone=form.contactPhone,digits=phone?.replace(/\D/g,'');
 if(!phone&&!form.email&&!form.messengerUrl)issues.push('Укажите телефон, email или мессенджер.');
 if(phone&&(!/^[+\d\s().-]+$/.test(phone)||!(digits?.length===10||(digits?.length===11&&/^[78]/.test(digits)))))issues.push('Проверьте номер телефона.');
 if(form.kind==='specialist'){
  if(!form.professionName)issues.push('Выберите профессию.');if(!form.price||BigInt(form.price.replace('.',''))<BigInt(10000))issues.push('Укажите стоимость работ от 100 ₽.');
  if(!form.skills||form.skills.length<3)issues.push('Опишите навыки от 3 символов.');
 }else{
  if(!form.category||!fairCategories.includes(form.category))issues.push('Выберите категорию ярмарки.');
  if(!form.contactPhone||!form.email)issues.push('Для заявки укажите телефон и email.');
 }
 return issues;
}
export function publicServicePublicationForm(form:ServicePublicationForm){
 if(form.kind==='marquee')return{kind:form.kind,title:form.title,href:form.href};
 const common={kind:form.kind,title:form.title,description:form.description,cityName:form.cityName,district:form.district,showExactAddress:form.showExactAddress,
  address:form.showExactAddress?form.address:null,latitude:form.showExactAddress?form.latitude:null,longitude:form.showExactAddress?form.longitude:null,photoIds:[...form.photoIds],videoUrl:form.videoUrl};
 return form.kind==='specialist'?{...common,professionName:form.professionName,price:form.price,skills:form.skills,experience:form.experience}:{...common,category:form.category};
}
