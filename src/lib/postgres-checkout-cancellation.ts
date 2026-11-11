import {withAppSessionTransaction,AppSessionAccessError} from './app-session-transaction';
import {hashSessionToken} from './identity';
import {parseListingDraftId} from './listing-draft-contract.ts';
import {parseCheckoutCancellation,type CheckoutCancellationResult} from './checkout-cancellation-contract.ts';
import type {PostgresDatabase} from './postgres';
export class CheckoutCancellationError extends Error{constructor(readonly code:'CHECKOUT_NOT_FOUND'|'CHECKOUT_STARTED'|'CHECKOUT_BUSY'){super('Checkout cancellation unavailable');this.name='CheckoutCancellationError';}}
export class PostgresCheckoutCancellation {
 constructor(private readonly db:Pick<PostgresDatabase,'transaction'>){}
 private async perform(token:string,expectedOwner:unknown,value:unknown,write:boolean):Promise<CheckoutCancellationResult|null>{
  const owner=parseListingDraftId(expectedOwner),input=parseCheckoutCancellation(value);
  try{return await withAppSessionTransaction(this.db,token,async(tx,user)=>{
   if(user.id!==owner)throw new AppSessionAccessError();
   if((await tx.query(`select o.id from app.payment_orders o join app.payment_checkout_intents i on i.id=o.id
    where o.id=$1 and o.owner_id=$2 and o.target_type=$3 and i.owner_id=o.owner_id and i.target_type=o.target_type
     and i.target_id=o.target_id and i.target_revision=o.target_revision and i.merchant_shop_id='local-fixture-shop' and i.is_test`,[input.paymentId,owner,input.targetType])).rowCount!==1)throw new CheckoutCancellationError('CHECKOUT_NOT_FOUND');
   if(write){await tx.query("select set_config('blizhniy.checkout_cancel_session',$1,true)",[hashSessionToken(token)]);
    await tx.query('insert into app.payment_checkout_cancellations(payment_id) values($1) on conflict(payment_id) do nothing',[input.paymentId]);}
   const row=(await tx.query('select payment_id from app.payment_checkout_cancellations where payment_id=$1 and owner_id=$2 and target_type=$3',[input.paymentId,owner,input.targetType])).rows[0];
   if(write&&!row)throw new CheckoutCancellationError('CHECKOUT_NOT_FOUND');return row?{...input,state:'cancelled' as const}:null;
  });}catch(error){if(error&&typeof error==='object'&&'code'in error){
   if(error.code==='PCA03')throw new AppSessionAccessError();if(error.code==='PCA01')throw new CheckoutCancellationError('CHECKOUT_NOT_FOUND');
   if(error.code==='PCA02')throw new CheckoutCancellationError('CHECKOUT_STARTED');if(error.code==='55P03')throw new CheckoutCancellationError('CHECKOUT_BUSY');
  }throw error;}
 }
 read(token:string,owner:unknown,value:unknown){return this.perform(token,owner,value,false);}
 cancel(token:string,owner:unknown,value:unknown){return this.perform(token,owner,value,true);}
}
