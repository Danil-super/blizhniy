import {ListingDraftInputError,parseListingDraftId,parseListingDraftCursor} from './listing-draft-contract.ts';
import {validPlainText} from './cabinet-field-validation.ts';
import type {Tariff} from './types';
export type ManagedTariff={id:string;action:Tariff['action'];name:string;price:string;durationDays:number|null;active:boolean;revision:string};
export type TariffChange={id:string;tariffId:string;expectedRevision:string;name:string;price:string;durationDays:number|null;active:boolean;reason:string};
export type AdminTariffCommand={resource:'tariffs';action:'list';expectedAdminId:string}|{resource:'tariffs';action:'change';expectedAdminId:string;input:TariffChange}|{resource:'tariffs';action:'recover';expectedAdminId:string;tariffId:string;id:string};
export type TariffReceipt={id:string;actorId:string;tariffId:string;expectedRevision:string;previous:ManagedTariff;next:ManagedTariff;reason:string;changed:boolean;createdAt:string};
export type AdminTariffResult={tariffs:ManagedTariff[];receipt:TariffReceipt|null;history:TariffReceipt[]};
function invalid():never{throw new ListingDraftInputError();}
function object(value:unknown,keys:string[]){
 if(!value||typeof value!=='object'||Array.isArray(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value))||Reflect.ownKeys(value).length!==keys.length||keys.some(key=>!Object.hasOwn(value,key)))invalid();
 return value as Record<string,unknown>;
}
const slug=(value:unknown)=>typeof value==='string'&&/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)&&value.length<=100?value:invalid();
const revision=(value:unknown)=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value)?value:invalid();
const bool=(value:unknown)=>typeof value==='boolean'?value:invalid();
const duration=(value:unknown)=>value===null?null:typeof value==='number'&&Number.isSafeInteger(value)&&value>=1&&value<=3650?value:invalid();
function text(value:unknown,min:number,max:number){if(typeof value!=='string'||!validPlainText(value)||[...value].length<min||[...value].length>max||value!==value.trim())invalid();return value;}
function money(value:unknown){if(typeof value!=='string'||!/^(?:0|[1-9]\d{0,9})\.\d{2}$/.test(value))invalid();return value;}
export function normalizeAdminTariffPrice(value:string){
 const source=value.trim().replace(',','.');if(!/^\d{1,10}(?:\.\d{1,2})?$/.test(source))invalid();
 const [whole,part='']=source.split('.');return whole.replace(/^0+(?=\d)/,'')+'.'+part.padEnd(2,'0');
}
function tariff(value:unknown):ManagedTariff{
 const row=object(value,['id','action','name','price','durationDays','active','revision']);
 if(!['listing_publication','vacancy_publication','work_request_publication','specialist_publication','job_response','fair_participation','ad_marquee'].includes(String(row.action)))invalid();
 return {id:slug(row.id),action:row.action as Tariff['action'],name:text(row.name,1,200),price:money(row.price),durationDays:duration(row.durationDays),active:bool(row.active),revision:revision(row.revision)};
}
export function parseAdminTariffCommand(value:unknown):AdminTariffCommand{
 if(!value||typeof value!=='object'||Array.isArray(value))invalid();const action=(value as Record<string,unknown>).action;
 if(action==='list'){const row=object(value,['resource','action','expectedAdminId']);if(row.resource!=='tariffs')invalid();return {resource:'tariffs',action,expectedAdminId:parseListingDraftId(row.expectedAdminId)};}
 if(action==='recover'){const row=object(value,['resource','action','expectedAdminId','tariffId','id']);if(row.resource!=='tariffs')invalid();return {resource:'tariffs',action,expectedAdminId:parseListingDraftId(row.expectedAdminId),tariffId:slug(row.tariffId),id:parseListingDraftId(row.id)};}
 const row=object(value,['resource','action','expectedAdminId','input']);if(row.resource!=='tariffs'||action!=='change')invalid();
 const input=object(row.input,['id','tariffId','expectedRevision','name','price','durationDays','active','reason']);
 return {resource:'tariffs',action:'change',expectedAdminId:parseListingDraftId(row.expectedAdminId),input:{id:parseListingDraftId(input.id),tariffId:slug(input.tariffId),expectedRevision:revision(input.expectedRevision),name:text(input.name,1,200),price:money(input.price),durationDays:duration(input.durationDays),active:bool(input.active),reason:text(input.reason,3,500)}};
}
function receipt(value:unknown):TariffReceipt{
 const row=object(value,['id','actorId','tariffId','expectedRevision','previous','next','reason','changed','createdAt']);
 const parsed={id:parseListingDraftId(row.id),actorId:parseListingDraftId(row.actorId),tariffId:slug(row.tariffId),expectedRevision:revision(row.expectedRevision),previous:tariff(row.previous),next:tariff(row.next),reason:text(row.reason,3,500),changed:bool(row.changed),createdAt:parseListingDraftCursor({id:row.id,updatedAt:row.createdAt})!.updatedAt};
 const {previous,next}=parsed;
 if(previous.id!==parsed.tariffId||next.id!==parsed.tariffId||previous.action!==next.action||previous.revision!==parsed.expectedRevision||
  parsed.changed!==(previous.name!==next.name||previous.price!==next.price||previous.durationDays!==next.durationDays||previous.active!==next.active)||parsed.changed===(previous.revision===next.revision))invalid();
 return parsed;
}
export function parseAdminTariffResult(input:unknown,value:unknown):AdminTariffResult{
 const command=parseAdminTariffCommand(input),row=object(value,['tariffs','receipt','history']);
 if(!Array.isArray(row.tariffs)||row.tariffs.length>50||!Array.isArray(row.history)||row.history.length>10)invalid();
 const tariffs=row.tariffs.map(tariff),saved=row.receipt===null?null:receipt(row.receipt),history=row.history.map(receipt);
 if(new Set(tariffs.map(item=>item.id)).size!==tariffs.length||new Set(history.map(item=>item.id)).size!==history.length)invalid();
 if(command.action==='list'){if(saved||history.length)invalid();}
 else{
  const target=command.action==='change'?command.input.tariffId:command.tariffId;
  if(tariffs.length>1||tariffs.some(item=>item.id!==target)||history.some(item=>item.tariffId!==target)||saved&&(saved.tariffId!==target||saved.actorId!==command.expectedAdminId||saved.id!==(command.action==='change'?command.input.id:command.id)))invalid();
  if(command.action==='change'){
   const desired=command.input;if(!saved||tariffs.length!==1||saved.expectedRevision!==desired.expectedRevision||saved.reason!==desired.reason||saved.next.name!==desired.name||saved.next.price!==desired.price||saved.next.durationDays!==desired.durationDays||saved.next.active!==desired.active)invalid();
  }
  if(saved){const current=tariffs[0];if(current?.revision===saved.next.revision&&JSON.stringify(current)!==JSON.stringify(saved.next))invalid();const item=history.find(item=>item.id===saved.id);if(item&&JSON.stringify(item)!==JSON.stringify(saved))invalid();}
 }
 return {tariffs,receipt:saved,history};
}
export function tariffCheckoutNotice(value:ManagedTariff):string|null{
 if(!value.active)return 'Тариф отключён.';
 if(value.price==='0.00')return 'Цена 0 не означает бесплатную публикацию: платная оплата по этому тарифу недоступна.';
 const once=['job_response','fair_participation'].includes(value.action);
 if(once&&value.durationDays!==null)return 'Для этого действия тариф должен быть разовым, без срока в днях.';
 if(!once&&value.durationDays===null)return 'Для оплаты по этому тарифу нужен срок в днях.';
 return null;
}
export const tariffAdminErrorStatus={ADMIN_REQUIRED:403,OPERATION_CONFLICT:409,STALE_TARIFF:409,TARIFF_NOT_FOUND:404,ACCESS_BUSY:409,TARIFF_UNAVAILABLE:503,RATE_LIMITED:429} as const;
export type TariffAdminErrorCode=keyof typeof tariffAdminErrorStatus;
export class AdminTariffError extends Error{
 readonly code:TariffAdminErrorCode;
 constructor(code:TariffAdminErrorCode){super(({ADMIN_REQUIRED:'Доступ администратора не подтверждён.',OPERATION_CONFLICT:'Номер сохранения уже использован для другого решения.',STALE_TARIFF:'Тариф уже изменён. Обновите данные и проверьте решение.',TARIFF_NOT_FOUND:'Тариф не найден.',ACCESS_BUSY:'Тариф сейчас изменяется. Обновите данные.',TARIFF_UNAVAILABLE:'Не удалось подтвердить результат. Проверьте исходное сохранение.',RATE_LIMITED:'Слишком много запросов. Повторите позже.'})[code]);this.name='AdminTariffError';this.code=code;}
}
