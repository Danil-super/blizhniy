import {PostgresApplicationCompensationStore} from './postgres-application-compensation.ts';
import {PostgresApplicationCompensationRefundStore,ApplicationCompensationRefundError} from './postgres-application-compensation-refund.ts';
import {PostgresRefundRequestStore} from './postgres-refund-requests.ts';
import {createPrimaryRefundDispatcher} from './primary-refund-dispatch.ts';
import type {PostgresDatabase} from './postgres.ts';
import type {RefundTransactionAdmission} from './postgres-refund-dispatch.ts';
import {parseListingDraftId} from './listing-draft-contract.ts';

/** Private TEST composition; no HTTP, worker activation or grants. */
export function createApplicationCompensationRefundProcessor(
 db:Pick<PostgresDatabase,'transaction'>,
 config:Parameters<typeof createPrimaryRefundDispatcher>[1],
 fetcher:typeof fetch=globalThis.fetch,
){
 const merchant={...config},cases=new PostgresApplicationCompensationStore(db,merchant);
 const refunds=new PostgresApplicationCompensationRefundStore(db,merchant),requests=new PostgresRefundRequestStore(db,merchant);
 const dispatcher=createPrimaryRefundDispatcher(db,merchant,fetcher);
 return{async process(paymentIntentId:unknown,assertActive?:RefundTransactionAdmission){
  const id=parseListingDraftId(paymentIntentId);
  if(assertActive!==undefined&&typeof assertActive!=='function')throw new ApplicationCompensationRefundError();
  if(assertActive)await db.transaction(assertActive);
  const result=await cases.claim(id);if(result.state!=='claimed')return result;
  const operationId=await refunds.reserve(result.case.paymentIntentId),request=await requests.prepare(operationId);
  if(request.paymentIntentId!==result.case.paymentIntentId||request.amount!==result.case.amount)throw new ApplicationCompensationRefundError();
  const verification=await dispatcher.dispatch(operationId,()=>refunds.assertDispatch(operationId,assertActive),assertActive);
  if(verification.status!=='succeeded')return{state:verification.status,verification,effect:null};
  const effect=await refunds.apply(operationId,assertActive);
  if(effect.paymentIntentId!==verification.paymentIntentId||effect.providerRefundId!==verification.providerRefundId)throw new ApplicationCompensationRefundError();
  return{state:'applied' as const,verification,effect};
 }};
}
