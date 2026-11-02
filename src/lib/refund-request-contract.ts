export class RefundRequestError extends Error{
 constructor(){super('Refund request requires reconciliation');this.name='RefundRequestError';}
}
type Binding={operationId:string;paymentIntentId:string;providerPaymentId:string;amount:string};
const uuid=(value:unknown)=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value);
/** Full original amount only. Pure serialization, not permission to issue a refund. */
export function buildPlacementRefundRequest(value:Binding):{requestBody:string;idempotenceKey:string}{
 if(!value||typeof value!=='object'||Array.isArray(value)||!uuid(value.operationId)||!uuid(value.paymentIntentId)||!uuid(value.providerPaymentId)||
  typeof value.amount!=='string'||!/^(0|[1-9]\d{0,9})\.\d{2}$/.test(value.amount)||value.amount==='0.00')throw new RefundRequestError();
 return {idempotenceKey:'refund-'+value.operationId,requestBody:JSON.stringify({
  payment_id:value.providerPaymentId,amount:{value:value.amount,currency:'RUB'},
  metadata:{localRefundId:value.operationId,localPaymentId:value.paymentIntentId},
 })};
}
