import {PostgresRefundApprovalStore,RefundApprovalAccessError} from './postgres-refund-approvals.ts';
import {PostgresPlacementRefundReservationStore} from './postgres-placement-refund-reservations.ts';
import {PostgresRefundRequestStore} from './postgres-refund-requests.ts';
import {createPrimaryPlacementRefundProcessor} from './primary-placement-refund-processor.ts';
import type {PostgresDatabase} from './postgres.ts';
import type {RefundTransactionAdmission} from './postgres-refund-dispatch.ts';
/** Private TEST worker composition. No HTTP activation or automatic financial grants. */
export function createApprovedPlacementRefundProcessor(
 db:Pick<PostgresDatabase,'transaction'>,
 config:Parameters<typeof createPrimaryPlacementRefundProcessor>[1],
 fetcher:typeof fetch=globalThis.fetch,
){
 const merchant={...config},approvals=new PostgresRefundApprovalStore(db,merchant);
 const reservations=new PostgresPlacementRefundReservationStore(db,merchant),requests=new PostgresRefundRequestStore(db,merchant);
 const processor=createPrimaryPlacementRefundProcessor(db,merchant,fetcher);
 return{async process(approvalId:unknown,assertActive?:RefundTransactionAdmission){
  if(assertActive!==undefined&&typeof assertActive!=='function')throw new RefundApprovalAccessError();
  if(assertActive)await db.transaction(assertActive);
  const {approval}=await approvals.read(approvalId);
  const reservation=await reservations.reserve(approval.paymentIntentId,approval.id);
  // An older reservation can own another durable operation key. Do not silently
  // adopt its uncertain dispatch or create a replacement operation.
  if(reservation.id!==approval.id)throw new RefundApprovalAccessError();
  const prepared=await requests.prepare(approval.id);
  if(prepared.paymentIntentId!==approval.paymentIntentId||prepared.amount!==approval.amount)throw new RefundApprovalAccessError();
  // authorize() creates/reuses the original window only for a send. A known
  // provider candidate recovers by GET, including after expiry/completed refund.
  return processor.process(approval.id,()=>approvals.assertDispatch(approval.id,assertActive),assertActive);
 }};
}
