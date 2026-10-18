import {parseWorkPublicationForm,checkWorkPublicationForm,type WorkPublicationKind} from './work-publication-contract.ts';
import {parseListingDraftId} from './listing-draft-contract.ts';
import type {JobVacancy,WorkRequest} from './types';
export type PublicWorkRow={id:string;kind:WorkPublicationKind;form:unknown;mediaIds:string[];status:string;paid:boolean;createdAt:string;publishedAt:string|null;expiresAt:string|null};
const money=(value:string|null)=>!value||value==='0.00'?'по договоренности':`${value.split('.')[0].replace(/\B(?=(\d{3})+(?!\d))/g,' ')}${value.endsWith('.00')?'':','+value.split('.')[1]} ₽`;

/** Final public DTO boundary: no contacts, identifiers of owners or unchecked private form spread. */
export function mapPublicWorkPublication(row:PublicWorkRow,now:number):JobVacancy|WorkRequest|null{
 try{
  const id=parseListingDraftId(row.id),form=parseWorkPublicationForm(row.kind,row.form);
  const published=row.publishedAt?Date.parse(row.publishedAt):NaN,expires=row.expiresAt?Date.parse(row.expiresAt):NaN;
  // Date truncation can only close the public window early (<1ms), never late.
  if(row.status!=='published'||row.paid!==true||!Number.isFinite(now)||!Number.isFinite(published)||!Number.isFinite(expires)||published>now||expires<=now||expires<=published||
   !Number.isFinite(Date.parse(row.createdAt))||checkWorkPublicationForm(form).length||!form.cityName||!form.professionName||!Array.isArray(row.mediaIds)||JSON.stringify(row.mediaIds)!==JSON.stringify(form.photoIds))return null;
  const images=form.photoIds.map(photo=>`/api/work-publications/${id}/photos/${photo}`);
  const common={id,title:form.title,description:form.description,profession:form.professionName,city:form.cityName,
   ...(form.district?{district:form.district}:{}),showExactAddress:form.showExactAddress,
   ...(form.showExactAddress?{address:form.address!,lat:form.latitude!,lng:form.longitude!}:{}),images,status:'published' as const,createdAt:row.createdAt,publishedAt:row.publishedAt!};
  if(form.kind==='workRequest')return{...common,author:'Автор заказа',budget:money(form.budget)};
  return{...common,organization:form.organization!,employerType:form.employerType,salary:form.salary&&form.salary!=='0.00'?`от ${money(form.salary)}`:money(null),
   logoText:form.organization!.split(/\s+/).slice(0,2).map(word=>Array.from(word)[0]??'').join('').toLocaleUpperCase('ru'),logoTone:'blue',hasMapPoint:form.showExactAddress,
   ...(form.website?{website:form.website}:{}),...(form.schedule?{schedule:form.schedule}:{}),...(form.workFormat?{workFormat:form.workFormat}:{}),
   ...(form.requirements?{requirements:form.requirements}:{}),...(form.responsibilities?{responsibilities:form.responsibilities}:{}),...(form.conditions?{conditions:form.conditions}:{})};
 }catch{return null;}
}
