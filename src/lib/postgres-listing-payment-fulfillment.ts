import {PostgresPaymentIntentStore} from './postgres-payment-intents.ts';
import {PostgresListingFormStore} from './postgres-listing-form';
import {parseListingDraftId} from './listing-draft-contract.ts';
import {paymentPublicationPeriod,PaymentPublicationError,type PaymentPublicationPeriod} from './payment-publication-period.ts';
import type {PostgresDatabase} from './postgres';

type Result={state:'fulfilled';period:PaymentPublicationPeriod}|{state:'not_ready'|'blocked';reason:string};
type MerchantScope={shopId:string;isTest:boolean};
const receiptColumns=`to_char(published_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "publishedAt",
 to_char(expires_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "expiresAt"`;
/** Trusted worker only, not an owner API. Financial truth is committed separately by verification.
 * User -> intent -> order -> listing -> references -> moderation. No network I/O or automatic retries.
 */
export class PostgresListingPaymentFulfillmentStore{
 private readonly db:Pick<PostgresDatabase,'transaction'>;
 private readonly intents:PostgresPaymentIntentStore;
 private readonly forms:PostgresListingFormStore;
 private readonly merchant:MerchantScope;
 constructor(db:Pick<PostgresDatabase,'transaction'>,merchant:MerchantScope){
  if(typeof window!=='undefined'||!merchant||typeof merchant.shopId!=='string'||!/^[a-zA-Z0-9_-]{1,64}$/.test(merchant.shopId)||typeof merchant.isTest!=='boolean')throw new PaymentPublicationError();
  this.merchant={...merchant};
  this.db=db;this.intents=new PostgresPaymentIntentStore(db);this.forms=new PostgresListingFormStore(db);
 }
 async fulfill(value:unknown):Promise<Result>{
  const id=parseListingDraftId(value);
  return this.db.transaction(async tx=>{
   // Match the session writers' user-first order; the immutable intent owner is not a request field.
   const user=(await tx.query<{blocked:boolean;verified:boolean}>(`select is_blocked as blocked,email_verified_at is not null as verified
    from app.users where id=(select owner_id from app.payment_checkout_intents where id=$1) for update`,[id])).rows[0];
   const intent=await this.intents.lockKnownInTransaction(tx,id);
   if(intent.targetType!=='listing'||intent.durationDays===null||intent.shopId!==this.merchant.shopId||intent.isTest!==this.merchant.isTest)throw new PaymentPublicationError();
   const order=(await tx.query<{status:string}>('select status from app.payment_orders where id=$1 for update',[id])).rows[0];
   if(!order)throw new PaymentPublicationError();
   // A receipt is historical. Replay must not depend on a target still being a draft or resurrect it.
   const existing=(await tx.query<PaymentPublicationPeriod>(`select ${receiptColumns} from app.payment_fulfillments where intent_id=$1`,[id])).rows[0];
   if(existing)return{state:'fulfilled',period:existing};
   const verified=(await tx.query<{status:string;capturedAt:string|null;providerId:string}>(`select status,captured_at as "capturedAt",provider_payment_id as "providerId"
    from app.payment_verifications where intent_id=$1`,[id])).rows[0];
   if(order.status!=='succeeded'||verified?.status!=='succeeded'||verified.capturedAt===null)return{state:'not_ready',reason:'capture_required'};
   if(verified.providerId!==intent.providerPaymentId)throw new PaymentPublicationError();
   if(!user||user.blocked||!user.verified)return{state:'blocked',reason:'account_unavailable'};
   const listing=(await tx.query<{revision:string;status:string;paid:boolean;category:string|null;city:string|null}>(`select revision::text,status,is_paid as paid,category_id as category,city_id as city
    from app.listings where id=$1 and author_id=$2 for update`,[intent.targetId,intent.ownerId])).rows[0];
   if(!listing||listing.revision!==intent.targetRevision||listing.status!=='draft'||listing.paid)return{state:'blocked',reason:'target_changed'};
   // Lock changing references before the canonical form inspection, not just the target row.
   const category=(await tx.query<{parent:string|null}>('select parent_id as parent from app.categories where id=$1 for share',[listing.category])).rows[0];
   if(category?.parent)await tx.query('select id from app.categories where id=$1 for share',[category.parent]);
   await tx.query('select id from app.cities where id=$1 for share',[listing.city]);
   await tx.query(`select m.id from app.media_objects m join app.listing_photos p on p.media_id=m.id
    where p.listing_id=$1 order by m.id limit 10001 for share of m`,[intent.targetId]);
   const approval=await tx.query(`select id from app.listing_moderation where listing_id=$1 and revision=$2::bigint and state='approved' for share`,[intent.targetId,intent.targetRevision]);
   if(approval.rowCount!==1)return{state:'blocked',reason:'approval_required'};
   const {check}=await this.forms.inspectInTransaction(tx,intent.ownerId,intent.targetId,intent.targetRevision);
   // Price and duration were accepted in the original immutable order; a new tariff is not a new consent.
   if(check.issues.some(issue=>issue.field!=='tariff'))return{state:'blocked',reason:'content_unavailable'};
   const period=paymentPublicationPeriod(verified.capturedAt,intent.durationDays);
   const updated=await tx.query(`update app.listings set status='published',is_paid=true,published_at=$4::timestamptz,expires_at=$5::timestamptz,updated_at=clock_timestamp()
    where id=$1 and author_id=$2 and revision=$3::bigint and status='draft' and not is_paid and published_at is null and expires_at is null
     and created_at<=$4::timestamptz and $4::timestamptz<=clock_timestamp() and $5::timestamptz>clock_timestamp()`,[intent.targetId,intent.ownerId,intent.targetRevision,period.publishedAt,period.expiresAt]);
   if(updated.rowCount!==1)return{state:'blocked',reason:'period_unavailable'};
   await tx.query('insert into app.payment_fulfillments(intent_id,published_at,expires_at) values($1,$2::timestamptz,$3::timestamptz)',[id,period.publishedAt,period.expiresAt]);
   return{state:'fulfilled',period};
  });
 }
}
