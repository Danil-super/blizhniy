import {PostgresPaymentIntentStore} from './postgres-payment-intents.ts';
import {PostgresListingFormStore} from './postgres-listing-form';
import {parseListingDraftId} from './listing-draft-contract.ts';
import {paymentPublicationPeriod,PaymentPublicationError,type PaymentPublicationPeriod} from './payment-publication-period.ts';
import type {PostgresDatabase,PostgresQueries} from './postgres';
import {inspectWorkPurchase} from './vacancy-purchase-eligibility';
import {readPostmoderationEnabled} from './listing-workflow-config';
import {WorkPublicationAccessError,WorkPublicationConflictError} from './postgres-work-publications';
import {WorkPublicationInputError} from './work-publication-contract';
import {inspectSpecialistPurchase} from './specialist-purchase-eligibility';
import {readSpecialistCheckoutEnabled} from './specialist-checkout-config';
import {ServicePublicationAccessError,ServicePublicationConflictError} from './postgres-service-publications';

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
 private readonly targetType:'listing'|'vacancy'|'workRequest'|'specialist';
 constructor(db:Pick<PostgresDatabase,'transaction'>,merchant:MerchantScope,private readonly policy:{postmoderation?:boolean;targetType?:'vacancy'|'workRequest'|'specialist';renewals?:boolean;publicationTestOwner?:string}={}){
  if(typeof window!=='undefined'||!merchant||typeof merchant.shopId!=='string'||!/^[a-zA-Z0-9_-]{1,64}$/.test(merchant.shopId)||typeof merchant.isTest!=='boolean')throw new PaymentPublicationError();
  this.merchant={...merchant};
  if(policy.publicationTestOwner!==undefined&&(!merchant.isTest||parseListingDraftId(policy.publicationTestOwner)!==policy.publicationTestOwner||!policy.postmoderation||!readPostmoderationEnabled()))throw new PaymentPublicationError();
  this.targetType=policy.targetType??'listing';
  if(this.targetType==='specialist'){
   if(!readSpecialistCheckoutEnabled()||!merchant.isTest||merchant.shopId!=='local-fixture-shop'||policy.renewals||policy.publicationTestOwner)throw new PaymentPublicationError();
  }else if(this.targetType!=='listing'&&(!['vacancy','workRequest'].includes(this.targetType)||!merchant.isTest||!readPostmoderationEnabled()))throw new PaymentPublicationError();
  if(policy.renewals!==undefined&&typeof policy.renewals!=='boolean'||policy.renewals&&(!merchant.isTest||process.env.BLIZHNIY_LOCAL_PRIMARY!=='enabled'||!readPostmoderationEnabled()))throw new PaymentPublicationError();
  this.db=db;this.intents=new PostgresPaymentIntentStore(db);this.forms=new PostgresListingFormStore(db,{postmoderation:policy.renewals===true,renewals:policy.renewals===true});
 }
 private async renew(tx:PostgresQueries,intent:{id:string;ownerId:string;targetId:string}):Promise<Result>{
  const table=this.targetType==='listing'?'listings':'work_publications';
  const previous=(await tx.query<{id:string}>(`select i.id from app.payment_checkout_intents i
   join app.payment_orders o on o.id=i.id and o.status='succeeded' join app.payment_fulfillments f on f.intent_id=i.id
   join app.${table} target on target.id=i.target_id and target.author_id=i.owner_id
    and target.published_at=f.published_at and target.expires_at=f.expires_at
   where i.owner_id=$1 and i.target_type=$2 and i.target_id=$3 and i.id<>$4 and i.merchant_shop_id=$5 and i.is_test=$6 limit 2`,
  [intent.ownerId,this.targetType,intent.targetId,intent.id,this.merchant.shopId,this.merchant.isTest])).rows;
  if(previous.length!==1)return{state:'blocked',reason:'renewal_basis_unavailable'};
  const period=(await tx.query<PaymentPublicationPeriod>(`insert into app.payment_renewals(intent_id,previous_intent_id) values($1,$2)
   returning ${receiptColumns}`,[intent.id,previous[0].id])).rows[0];
  if(!period)throw new PaymentPublicationError();return{state:'fulfilled',period};
 }
 async fulfill(value:unknown):Promise<Result>{
  if(this.targetType==='specialist'&&!readSpecialistCheckoutEnabled())throw new PaymentPublicationError();
  const id=parseListingDraftId(value);
  return this.db.transaction(async tx=>{
   // Detect the actual installed trigger, never a separately configured flag.
   // Its SQL guard remains the authority; old databases retain capture-time rules.
   const phoneVerification=(await tx.query<{ready:boolean}>("select exists(select 1 from pg_trigger t join pg_proc p on p.oid=t.tgfoid join pg_namespace n on n.oid=p.pronamespace where t.tgname=$1 and t.tgrelid=$2::regclass and t.tgenabled in ('O','A') and p.proname='guard_phone_payment_window' and n.nspname='app') as ready",[this.targetType==='listing'?'listing_phone_payment_window':'work_phone_payment_window',this.targetType==='listing'?'app.listings':'app.work_publications'])).rows[0]?.ready===true;
   // Match the session writers' user-first order; the immutable intent owner is not a request field.
   const user=(await tx.query<{blocked:boolean;verified:boolean}>(`select is_blocked as blocked,email_verified_at is not null as verified
    from app.users where id=(select owner_id from app.payment_checkout_intents where id=$1) for update`,[id])).rows[0];
   const intent=await this.intents.lockKnownInTransaction(tx,id);
   if(intent.targetType!==this.targetType||intent.durationDays===null||intent.shopId!==this.merchant.shopId||intent.isTest!==this.merchant.isTest)throw new PaymentPublicationError();
   if(this.policy.publicationTestOwner&&(intent.ownerId!==this.policy.publicationTestOwner||JSON.parse(intent.requestBody).metadata.publicationMode!=='account-test-v1'))return{state:'blocked',reason:'publication_not_admitted'};
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
   if(this.targetType==='specialist'){
    try{if((await inspectSpecialistPurchase(this.db,tx,intent.ownerId,intent.targetId,intent.targetRevision)).issues.length)return{state:'blocked',reason:'content_unavailable'};}
    catch(error){if(error instanceof ServicePublicationAccessError||error instanceof ServicePublicationConflictError)return{state:'blocked',reason:'target_changed'};throw error;}
    if(!readSpecialistCheckoutEnabled())throw new PaymentPublicationError();
    const period=(await tx.query<PaymentPublicationPeriod>(`insert into app.payment_fulfillments(intent_id) values($1) returning ${receiptColumns}`,[id])).rows[0];
    if(!period)throw new PaymentPublicationError();return{state:'fulfilled',period};
   }
   if(this.targetType!=='listing'){
    let inspected:Awaited<ReturnType<typeof inspectWorkPurchase>>;
    try{inspected=await inspectWorkPurchase(this.db,tx,intent.ownerId,intent.targetId,intent.targetRevision,this.targetType,true,this.policy.renewals===true);}
    catch(error){
     if(error instanceof WorkPublicationAccessError||error instanceof WorkPublicationConflictError)return{state:'blocked',reason:'target_changed'};
     if(error instanceof WorkPublicationInputError)return{state:'blocked',reason:'content_unavailable'};
     throw error;
    }
    const {issues}=inspected;
    if(issues.length)return{state:'blocked',reason:'content_unavailable'};
    if(this.policy.renewals&&inspected.snapshot.paid)return this.renew(tx,intent);
    const period=paymentPublicationPeriod(verified.capturedAt,intent.durationDays);
    const updated=await tx.query(`update app.work_publications set status='published',is_paid=true,published_at=$4::timestamptz,expires_at=$5::timestamptz,updated_at=clock_timestamp()
     where id=$1 and author_id=$2 and kind=$6 and revision=$3::bigint and status='draft' and not is_paid and deleted_at is null
      and published_at is null and expires_at is null and created_at<=$4::timestamptz and $4::timestamptz<=clock_timestamp() ${phoneVerification?'':'and $5::timestamptz>clock_timestamp()'}${phoneVerification?' returning '+receiptColumns:''}`,
     [intent.targetId,intent.ownerId,intent.targetRevision,period.publishedAt,period.expiresAt,this.targetType]);
    if(updated.rowCount!==1)return{state:'blocked',reason:'period_unavailable'};
    const actual=phoneVerification?updated.rows[0] as PaymentPublicationPeriod:period;
    if(!actual?.publishedAt||!actual.expiresAt)throw new PaymentPublicationError();
    await tx.query('insert into app.payment_fulfillments(intent_id,published_at,expires_at) values($1,$2::timestamptz,$3::timestamptz)',[id,actual.publishedAt,actual.expiresAt]);
    return{state:'fulfilled',period:actual};
   }
   const listing=(await tx.query<{revision:string;status:string;paid:boolean;category:string|null;city:string|null}>(`select revision::text,status,is_paid as paid,category_id as category,city_id as city
    from app.listings where id=$1 and author_id=$2 for update`,[intent.targetId,intent.ownerId])).rows[0];
   if(!listing||listing.revision!==intent.targetRevision||(!this.policy.renewals&&(listing.status!=='draft'||listing.paid)))return{state:'blocked',reason:'target_changed'};
   // Lock changing references before the canonical form inspection, not just the target row.
   const category=(await tx.query<{parent:string|null}>('select parent_id as parent from app.categories where id=$1 for share',[listing.category])).rows[0];
   if(category?.parent)await tx.query('select id from app.categories where id=$1 for share',[category.parent]);
   await tx.query('select id from app.cities where id=$1 for share',[listing.city]);
   await tx.query(`select m.id from app.media_objects m join app.listing_photos p on p.media_id=m.id
    where p.listing_id=$1 order by m.id limit 10001 for share of m`,[intent.targetId]);
   if(this.policy.postmoderation){
    const blocked=await tx.query('select listing_id from app.listing_blocks where listing_id=$1',[intent.targetId]);
    if(blocked.rowCount!==0)return{state:'blocked',reason:'listing_blocked'};
   }else{
    const approval=await tx.query(`select id from app.listing_moderation where listing_id=$1 and revision=$2::bigint and state='approved' for share`,[intent.targetId,intent.targetRevision]);
    if(approval.rowCount!==1)return{state:'blocked',reason:'approval_required'};
   }
   const {check}=await this.forms.inspectInTransaction(tx,intent.ownerId,intent.targetId,intent.targetRevision,this.policy.renewals===true);
   // Price and duration were accepted in the original immutable order; a new tariff is not a new consent.
   if(check.issues.some(issue=>issue.field!=='tariff'))return{state:'blocked',reason:'content_unavailable'};
   if(this.policy.renewals&&listing.paid)return this.renew(tx,intent);
   const period=paymentPublicationPeriod(verified.capturedAt,intent.durationDays);
   const updated=await tx.query(`update app.listings set status='published',is_paid=true,published_at=$4::timestamptz,expires_at=$5::timestamptz,updated_at=clock_timestamp()
    where id=$1 and author_id=$2 and revision=$3::bigint and status='draft' and not is_paid and published_at is null and expires_at is null
     and created_at<=$4::timestamptz and $4::timestamptz<=clock_timestamp() ${phoneVerification?'':'and $5::timestamptz>clock_timestamp()'}${phoneVerification?' returning '+receiptColumns:''}`,[intent.targetId,intent.ownerId,intent.targetRevision,period.publishedAt,period.expiresAt]);
   if(updated.rowCount!==1)return{state:'blocked',reason:'period_unavailable'};
    const actual=phoneVerification?updated.rows[0] as PaymentPublicationPeriod:period;
    if(!actual?.publishedAt||!actual.expiresAt)throw new PaymentPublicationError();
   await tx.query('insert into app.payment_fulfillments(intent_id,published_at,expires_at) values($1,$2::timestamptz,$3::timestamptz)',[id,actual.publishedAt,actual.expiresAt]);
   return{state:'fulfilled',period:actual};
  });
 }
}
