import {validateBookingDetailsForPublication} from './booking-details';
import type {ListingFormDraft,ListingFormSnapshot} from './listing-form-contract';
export type ListingPublicationIssue={field:'title'|'description'|'category'|'city'|'contact'|'booking'|'tariff';message:string};
export type ListingPublicationCheck={listingId:string;revision:string;checksPassed:boolean;issues:ListingPublicationIssue[];
 tariff:{id:string;name:string;amount:string;currency:'RUB';durationDays:number}|null};
export type PublicationTariffRow={id:string;action:string;name:string;amount:string;durationDays:number|null;active:boolean};
/** A point-in-time content/offer inspection, never a payment authorization or moderation approval. */
export function checkListingFormContent(form:ListingFormDraft,categoryActive:boolean):ListingPublicationIssue[]{
 const issues:ListingPublicationIssue[]=[];
 const issue=(field:ListingPublicationIssue['field'],message:string)=>issues.push({field,message});
 if(form.title.length<3||form.title.length>120)issue('title','Название для публикации должно содержать от 3 до 120 символов.');
 if(!form.description.trim()||form.description.length>3000)issue('description','Добавьте описание длиной до 3000 символов.');
 if(!form.categorySlug||!categoryActive)issue('category','Выберите действующую категорию и подкатегорию, если она нужна.');
 if(!form.cityName)issue('city','Выберите город.');
 const digits=form.contactPhone?.replace(/\D/g,'');
 if((!form.contactPhone&&!form.messengerUrl)||(form.contactPhone&&!(digits?.length===10||(digits?.length===11&&/^[78]/.test(digits)))))issue('contact','Укажите корректный российский телефон или мессенджер; исправьте заполненный телефон.');
 if(form.kind==='arenda')for(const message of validateBookingDetailsForPublication(form.booking??undefined))issue('booking',message);
 return issues;
}
export function checkListingPublication(snapshot:ListingFormSnapshot,categoryActive:boolean,offer:PublicationTariffRow|null):ListingPublicationCheck{
 const issues=checkListingFormContent(snapshot.form,categoryActive);
 let tariff:ListingPublicationCheck['tariff']=null;
 if(offer&&offer.active===true&&offer.action==='listing_publication'&&typeof offer.id==='string'&&/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(offer.id)&&offer.id.length<=100&&
  typeof offer.name==='string'&&offer.name.trim().length>0&&offer.name.length<=200&&typeof offer.amount==='string'&&/^(0|[1-9]\d{0,9})\.\d{2}$/.test(offer.amount)&&
  Number.isSafeInteger(offer.durationDays)&&offer.durationDays!==null&&offer.durationDays>=1&&offer.durationDays<=3650){
  tariff={id:offer.id,name:offer.name,amount:offer.amount,currency:'RUB',durationDays:offer.durationDays};
 }else issues.push({field:'tariff',message:'Действующий тариф размещения недоступен. Повторите проверку позже.'});
 return{listingId:snapshot.id,revision:snapshot.revision,checksPassed:issues.length===0,issues,tariff};
}
