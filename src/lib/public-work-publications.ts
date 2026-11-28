import {parseWorkPublicationForm,checkWorkPublicationForm,type WorkPublicationKind} from './work-publication-contract.ts';
import {parseListingDraftId} from './listing-draft-contract.ts';
import type {JobVacancy,WorkRequest} from './types';
import type {PublicText} from './publication-location-withdrawal';
export type PublicWorkRow={id:string;kind:WorkPublicationKind;form:unknown;professionId?:string|null;mediaIds:string[];withdrawnPhotos?:string[];status:string;paid:boolean;createdAt:string;publishedAt:string|null;expiresAt:string|null;updatedAt?:string;contentEdited?:boolean;testPublication?:boolean;locationWithdrawn?:boolean;publicText?:PublicText};
const money=(value:string|null)=>!value||value==='0.00'?'по договоренности':`${value.split('.')[0].replace(/\B(?=(\d{3})+(?!\d))/g,' ')}${value.endsWith('.00')?'':','+value.split('.')[1]} ₽`;

/** Final public DTO boundary: no contacts, identifiers of owners or unchecked private form spread. */
export function mapPublicWorkPublication(row:PublicWorkRow,now:number):JobVacancy|WorkRequest|null{
 try{
  const id=parseListingDraftId(row.id),form=parseWorkPublicationForm(row.kind,row.form);
  const published=row.publishedAt?Date.parse(row.publishedAt):NaN,expires=row.expiresAt?Date.parse(row.expiresAt):NaN;
  // Date truncation can only close the public window early (<1ms), never late.
  if(row.status!=='published'||row.paid!==true||!Number.isFinite(now)||!Number.isFinite(published)||!Number.isFinite(expires)||published>now||expires<=now||expires<=published||
   !Number.isFinite(Date.parse(row.createdAt))||checkWorkPublicationForm(form).length||!form.cityName||!form.professionName||!Array.isArray(row.mediaIds)||JSON.stringify(row.mediaIds)!==JSON.stringify(form.photoIds))return null;
  const images=form.photoIds.filter(photo=>!row.withdrawnPhotos?.includes(photo)).map(photo=>`/api/work-publications/${id}/photos/${photo}`);
  const showExactAddress=form.showExactAddress&&row.locationWithdrawn!==true;
  const title=(row.publicText?.title??form.title)||(form.kind==='vacancy'?'Вакансия':'Заказ');
  const common={id,...(row.testPublication===true?{testPublication:true}:{}),title:row.testPublication===true?`ТЕСТ · ${title}`:title,description:row.publicText?.description??form.description,profession:form.professionName,...(row.professionId?{professionId:parseListingDraftId(row.professionId)}:{}),city:form.cityName,
   ...(form.district?{district:form.district}:{}),showExactAddress,
   ...(showExactAddress?{address:form.address!,lat:form.latitude!,lng:form.longitude!}:{}),images,status:'published' as const,createdAt:row.createdAt,publishedAt:row.publishedAt!};
  if(form.kind==='workRequest')return{...common,author:'Автор заказа',budget:money(form.budget),...(row.contentEdited!==false&&row.updatedAt&&Number.isFinite(Date.parse(row.updatedAt))&&Date.parse(row.updatedAt)>published?{updatedAt:row.updatedAt}:{})};
  const organization=(row.publicText?.organization??form.organization)||'Работодатель';
  const text={...form};
  for(const field of ['schedule','workFormat','requirements','responsibilities','conditions'] as const)
   text[field]=row.publicText?.[field]??form[field];
  return{...common,organization,employerType:form.employerType,salary:form.salary&&form.salary!=='0.00'?`от ${money(form.salary)}`:money(null),
   logoText:organization.split(/\s+/).slice(0,2).map(word=>Array.from(word)[0]??'').join('').toLocaleUpperCase('ru'),logoTone:'blue',hasMapPoint:showExactAddress,
   ...(form.website?{website:form.website}:{}),...(text.schedule?{schedule:text.schedule}:{}),...(text.workFormat?{workFormat:text.workFormat}:{}),
   ...(text.requirements?{requirements:text.requirements}:{}),...(text.responsibilities?{responsibilities:text.responsibilities}:{}),...(text.conditions?{conditions:text.conditions}:{})};
 }catch{return null;}
}
