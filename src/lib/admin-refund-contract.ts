import {parseListingDraftId} from './listing-draft-contract.ts';
import {validPlainText} from './cabinet-field-validation.ts';
import type {AdminRefundPage,AdminRefundPayment} from './postgres-admin-refund-journal';
export type RefundApprovalCommand={id:string;paymentIntentId:string;reason:string};
export type RefundRecoveryCommand={id:string;operationId:string;providerRefundId:string;reason:string};
export type AdminRefundCommand={expectedAdminId:string}&({action:'list';input:string|null}|{action:'read';input:string}|{action:'approve';input:RefundApprovalCommand}|{action:'recover';input:RefundRecoveryCommand});
export type AdminRefundApproval={id:string;paymentIntentId:string;reason:string;amount:string;approvedAt:string};
export type AdminRefundRecovery={actionId:string;operationId:string;providerRefundId:string;status:'pending'|'succeeded'|'canceled';state:'pending'|'applied'|'canceled'};
export class AdminRefundInputError extends Error {constructor(){super('Invalid refund administration data');}}
function fail():never{throw new AdminRefundInputError();}
function object(value:unknown,keys:string[]){
 if(!value||typeof value!=='object'||Array.isArray(value)||Reflect.ownKeys(value).length!==keys.length||keys.some(key=>!Object.hasOwn(value,key)))fail();
 return value as Record<string,unknown>;
}
const id=(value:unknown)=>parseListingDraftId(value);
const reason=(value:unknown)=>{if(typeof value!=='string'||!value.trim()||value.length>500||!validPlainText(value))fail();return value.trim();};
function stamp(value:unknown):string{if(typeof value!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,9})?Z$/.test(value)||!Number.isFinite(Date.parse(value))||new Date(value).toISOString().slice(0,19)!==value.slice(0,19))fail();return value;}
function money(value:unknown):string{if(typeof value!=='string'||!/^(?:0|[1-9]\d{0,9})\.\d{2}$/.test(value)||value==='0.00')fail();return value;}
const optional=<T>(value:unknown,parse:(v:unknown)=>T):T|null=>value===null?null:parse(value);
export function parseAdminRefundCommand(value:unknown):AdminRefundCommand{
 const row=object(value,['action','expectedAdminId','input']),expectedAdminId=id(row.expectedAdminId);
 if(row.action==='list')return{action:'list',expectedAdminId,input:optional(row.input,id)};
 if(row.action==='read')return{action:'read',expectedAdminId,input:id(row.input)};
 if(row.action==='approve'){
  const input=object(row.input,['id','paymentIntentId','reason']);return{action:'approve',expectedAdminId,input:{id:id(input.id),paymentIntentId:id(input.paymentIntentId),reason:reason(input.reason)}};
 }
 if(row.action==='recover'){
  const input=object(row.input,['id','operationId','providerRefundId','reason']);return{action:'recover',expectedAdminId,input:{id:id(input.id),operationId:id(input.operationId),providerRefundId:id(input.providerRefundId),reason:reason(input.reason)}};
 }
 return fail();
}
export function parseAdminRefundPage(value:unknown):AdminRefundPage{
 const page=object(value,['items','nextAfter']);if(!Array.isArray(page.items)||page.items.length>50)fail();
 const items=page.items.map((value):AdminRefundPayment=>{
  const r=object(value,['id','targetType','targetId','amount','createdAt','status','capturedAt','operationId','attempted','approvalId','reason','approvedAt','providerRefundId','refundStatus','appliedAt']);
  if(typeof r.targetType!=='string'||!['listing','vacancy','workRequest','specialist','application','fair_application','ad_marquee'].includes(r.targetType)||typeof r.status!=='string'||!['created','pending','succeeded','failed','refunded'].includes(r.status)||
   r.refundStatus!==null&&(typeof r.refundStatus!=='string'||!['pending','succeeded','canceled'].includes(r.refundStatus)))fail();
  if(typeof r.attempted!=='boolean')fail();
  const result={operationId:optional(r.operationId,id),attempted:r.attempted,id:id(r.id),targetType:r.targetType,targetId:id(r.targetId),amount:money(r.amount),createdAt:stamp(r.createdAt),status:r.status,capturedAt:optional(r.capturedAt,stamp),approvalId:optional(r.approvalId,id),reason:optional(r.reason,reason),approvedAt:optional(r.approvedAt,stamp),providerRefundId:optional(r.providerRefundId,id),refundStatus:r.refundStatus as string|null,appliedAt:optional(r.appliedAt,stamp)};
  if([result.approvalId,result.reason,result.approvedAt].some(v=>v===null)&&[result.approvalId,result.reason,result.approvedAt].some(v=>v!==null)||result.refundStatus&&!result.providerRefundId||(result.attempted||result.providerRefundId)&&!result.operationId)fail();
  return result;
 });
 const nextAfter=optional(page.nextAfter,id);if(new Set(items.map(row=>row.id)).size!==items.length||nextAfter!==null&&(items.length!==50||items.at(-1)?.id!==nextAfter))fail();
 return{items,nextAfter};
}
export function parseAdminRefundApproval(value:unknown):AdminRefundApproval{
 const r=object(value,['id','paymentIntentId','reason','amount','approvedAt']);return{id:id(r.id),paymentIntentId:id(r.paymentIntentId),reason:reason(r.reason),amount:money(r.amount),approvedAt:stamp(r.approvedAt)};
}
export function parseAdminRefundRecovery(value:unknown):AdminRefundRecovery{
 const r=object(value,['actionId','operationId','providerRefundId','status','state']);
 if(!['pending','succeeded','canceled'].includes(String(r.status))||r.state!==(r.status==='succeeded'?'applied':r.status))fail();
 return{actionId:id(r.actionId),operationId:id(r.operationId),providerRefundId:id(r.providerRefundId),status:r.status as AdminRefundRecovery['status'],state:r.state as AdminRefundRecovery['state']};
}
/** Bind a response to the original command before displaying it or accepting a readback. */
export function parseAdminRefundResult(command:AdminRefundCommand,value:unknown){
 if(command.action==='list')return parseAdminRefundPage(value);
 if(command.action==='recover'){
  const result=parseAdminRefundRecovery(value),input=command.input;
  if(result.actionId!==input.id||result.operationId!==input.operationId||result.providerRefundId!==input.providerRefundId)fail();return result;
 }
 const result=parseAdminRefundApproval(value);
 if(result.id!==(command.action==='read'?command.input:command.input.id)||command.action==='approve'&&(result.paymentIntentId!==command.input.paymentIntentId||result.reason!==command.input.reason))fail();return result;
}
