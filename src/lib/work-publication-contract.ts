import {parseListingFormDraft} from './listing-form-contract.ts';
import {validateVacancyRequisites,type VacancyEmployerType} from './vacancy-requisites.ts';

export type WorkPublicationKind='vacancy'|'workRequest';
type Common={title:string;description:string;cityName:string|null;professionName:string|null;district:string|null;address:string|null;
 latitude:number|null;longitude:number|null;showExactAddress:boolean;contactPhone:string|null;messengerUrl:string|null;photoIds:string[];placementRightConfirmed:boolean};
export type WorkPublicationForm=Common&({kind:'workRequest';budget:string|null}|{kind:'vacancy';salary:string|null;organization:string|null;
 employerType:VacancyEmployerType;inn:string;ogrn:string;ogrnip:string;contactPerson:string|null;email:string|null;website:string|null;
 requirements:string|null;responsibilities:string|null;conditions:string|null;schedule:string|null;workFormat:string|null});
export class WorkPublicationInputError extends Error{constructor(){super('Invalid work publication');}}
const invalid=():never=>{throw new WorkPublicationInputError();};
const commonKeys=['kind','title','description','cityName','professionName','district','address','latitude','longitude','showExactAddress','contactPhone','messengerUrl','photoIds','placementRightConfirmed'];
const vacancyKeys=['salary','organization','employerType','inn','ogrn','ogrnip','contactPerson','email','website','requirements','responsibilities','conditions','schedule','workFormat'];
function text(value:unknown,max:number,multiline=false):string|null{
 if(value===undefined||value===null||value==='')return null;
 if(typeof value!=='string'||value.length>max||!value.isWellFormed()||(multiline?/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/:/[\u0000-\u001f\u007f]/).test(value))return invalid();
 return value.trim()||null;
}
/** Draft allowlist only: cookie authority, moderation and financial state are never form fields. */
export function parseWorkPublicationForm(kind:WorkPublicationKind,value:unknown):WorkPublicationForm{
 try{
  if(!['vacancy','workRequest'].includes(kind)||!value||typeof value!=='object'||Array.isArray(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value)))return invalid();
  const row=value as Record<string,unknown>,allowed=[...commonKeys,...(kind==='vacancy'?vacancyKeys:['budget'])];
  if(Reflect.ownKeys(row).some(key=>typeof key!=='string'||!allowed.includes(key))||(row.kind!==undefined&&row.kind!==kind))return invalid();
  const core=parseListingFormDraft({kind:'prodam',title:row.title??'',description:row.description??'',price:row[kind==='vacancy'?'salary':'budget']??null,
   cityName:row.cityName,district:row.district,address:row.address,latitude:row.latitude,longitude:row.longitude,showExactAddress:row.showExactAddress,
   contactPhone:row.contactPhone,messengerUrl:row.messengerUrl,photoIds:row.photoIds});
  if(core.title.length>120||core.photoIds.length>(kind==='vacancy'?20:6))return invalid();
  const placementRightConfirmed=Object.hasOwn(row,'placementRightConfirmed')?row.placementRightConfirmed:false;
  if(typeof placementRightConfirmed!=='boolean')return invalid();
  const common:Common={title:core.title,description:core.description,cityName:core.cityName,professionName:text(row.professionName,160),
   district:core.district,address:core.address,latitude:core.latitude,longitude:core.longitude,showExactAddress:core.showExactAddress,
   contactPhone:core.contactPhone,messengerUrl:core.messengerUrl,photoIds:core.photoIds,placementRightConfirmed};
  if(kind==='workRequest')return{kind,...common,budget:core.price};
  const employerType=row.employerType??'organization';if(!['organization','ip','person'].includes(employerType as string))return invalid();
  const requisite=(key:string,max:number)=>{const value=text(row[key],max)??'';if(!/^\d*$/.test(value))return invalid();return value;};
  const website=text(row.website,500);if(website){const url=new URL(website);if(!['https:','http:'].includes(url.protocol)||url.username||url.password)return invalid();}
  return{kind,...common,salary:core.price,employerType:employerType as VacancyEmployerType,organization:text(row.organization,200),
   inn:requisite('inn',12),ogrn:requisite('ogrn',13),ogrnip:requisite('ogrnip',15),contactPerson:text(row.contactPerson,160),email:text(row.email,254),website,
   requirements:text(row.requirements,3000,true),responsibilities:text(row.responsibilities,3000,true),conditions:text(row.conditions,3000,true),
   schedule:text(row.schedule,160),workFormat:text(row.workFormat,160)};
 }catch{return invalid();}
}
export function checkWorkPublicationForm(form:WorkPublicationForm):string[]{
 const issues:string[]=[];
 if(form.title.trim().length<3)issues.push('Укажите название от 3 до 120 символов.');
 if(!form.description.trim()||form.description.length>3000)issues.push('Добавьте описание длиной до 3000 символов.');
 if(!form.cityName)issues.push('Выберите город.');
 if(!form.professionName)issues.push('Выберите профессию или специализацию.');
 if(!form.placementRightConfirmed)issues.push('Подтвердите право размещать публикацию, фотографии и контактные данные.');
 const phone=form.contactPhone,digits=phone?.replace(/\D/g,'');
 if((!phone&&!form.messengerUrl)||(phone&&(!/^[+\d\s().-]+$/.test(phone)||!(digits?.length===10||(digits?.length===11&&/^[78]/.test(digits))))))issues.push('Укажите корректный телефон или мессенджер.');
 if(form.kind==='vacancy'){
  if(!form.organization)issues.push('Укажите работодателя.');
  const requisite=validateVacancyRequisites(form,{requireInn:true});if(requisite)issues.push(requisite);
  if(form.email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email))issues.push('Проверьте контактный email.');
 }
 return issues;
}
/** Explicit public projection, never spread a private form into public HTML/RSC/JSON. */
export function publicWorkPublicationForm(form:WorkPublicationForm){
 const common={kind:form.kind,title:form.title,description:form.description,cityName:form.cityName,professionName:form.professionName,district:form.district,
  showExactAddress:form.showExactAddress,address:form.showExactAddress?form.address:null,latitude:form.showExactAddress?form.latitude:null,
  longitude:form.showExactAddress?form.longitude:null,photoIds:[...form.photoIds]};
 return form.kind==='workRequest'?{...common,budget:form.budget}:{...common,salary:form.salary,organization:form.organization,employerType:form.employerType,
  website:form.website,requirements:form.requirements,responsibilities:form.responsibilities,conditions:form.conditions,schedule:form.schedule,workFormat:form.workFormat};
}
