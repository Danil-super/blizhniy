import {validPlainText} from './cabinet-field-validation.ts';
import {parseListingDraftId} from './listing-draft-contract.ts';
import {parsePaymentIntent} from './postgres-payment-intents.ts';
export class RefundApprovalInputError extends Error {
 constructor(){super('Refund approval requires verification');this.name='RefundApprovalInputError';}
}
export type PlacementRefundApprovalProposal={id:string;paymentIntentId:string;reason:string};
export type PlacementRefundFiscalMode='provider-automatic-full'|'test-without-receipt';
export function parsePlacementRefundApproval(value:unknown):PlacementRefundApprovalProposal {
 try{
  if(!value||typeof value!=='object'||Array.isArray(value)||Reflect.ownKeys(value).length!==3)throw Error();
  const row=value as Record<string,unknown>;
  if(!['id','paymentIntentId','reason'].every(key=>Object.hasOwn(row,key))||typeof row.reason!=='string'||row.reason.length>500||!row.reason.trim()||!validPlainText(row.reason))throw Error();
  return{id:parseListingDraftId(row.id),paymentIntentId:parseListingDraftId(row.paymentIntentId),reason:row.reason.trim()};
 }catch{throw new RefundApprovalInputError();}
}
/** Describe the original source only: NOT permission to dispatch or proof of administrator authority.
 * Full refunds reuse the original receipt automatically in the supported YooKassa receipt flow.
 * https://yookassa.ru/developers/payment-acceptance/receipts/54fz/yoomoney/refunds
 */
export function describeFullPlacementRefund(value:unknown,merchant:{shopId:string;isTest:boolean}):{policyVersion:'placement-full-admin-v1';fiscalMode:PlacementRefundFiscalMode;amount:string} {
 try{
  const original=parsePaymentIntent(value);
  if(!merchant||merchant.isTest!==true||!original.isTest||original.shopId!==merchant.shopId||!['listing','vacancy','workRequest'].includes(original.targetType)||original.durationDays===null)throw Error();
  const body=JSON.parse(original.requestBody);
  // The site's server-generated return URL uses an ASCII DNS authority. Keep
  // the same deliberately bounded subset in the independent SQL approval gate.
  const authority=body.confirmation.return_url.match(/^https:\/\/([^/?#]+)(?:[/?#]|$)/i)?.[1];
  const host=authority?.replace(/:443$/,'');
  if(!host||host.length>253||!/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(host))throw Error();
  return{policyVersion:'placement-full-admin-v1',fiscalMode:Object.hasOwn(body,'receipt')?'provider-automatic-full':'test-without-receipt',amount:original.amount};
 }catch{throw new RefundApprovalInputError();}
}
