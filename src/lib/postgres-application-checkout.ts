import {hashSessionToken} from './identity';
import {randomUUID} from 'node:crypto';
import {withAppSessionTransaction,AppSessionAccessError} from './app-session-transaction';
import {PostgresApplicationStore,ApplicationAccessError} from './postgres-applications';
import {PostgresPaymentIntentStore,parsePaymentIntent,type PaymentIntent,type PaymentIntentBinding} from './postgres-payment-intents';
import {parseListingDraftId,parseListingDraftRevision} from './listing-draft-contract.ts';
import {parseApplicationCheckout,ApplicationCheckoutConflictError,ApplicationCheckoutUnavailableError,type ApplicationPaymentOrder,type ApplicationQuote} from './application-checkout-contract.ts';
import {readApplicationAccountTest} from './application-test-config';
import {readPostmoderationEnabled} from './listing-workflow-config';
import type {PostgresDatabase,PostgresQueries} from './postgres';
type Offer=ApplicationQuote['tariff'];
type OrderRow=ApplicationPaymentOrder&{targetType:string};
const columns=`o.id,o.creation_key as "creationKey",o.target_type as "targetType",o.target_id as "targetId",o.target_revision::text as "targetRevision",o.status,i.tariff_id as "tariffId",i.amount::text,i.duration_days as "durationDays",to_char(o.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "createdAt"`;
const source="from app.payment_orders o join app.payment_checkout_intents i on i.id=o.id where o.target_type='application' and i.merchant_shop_id=$3 and i.is_test";
function display(row:OrderRow):ApplicationPaymentOrder{if(row.targetType!=='application'||row.durationDays!==null)throw new ApplicationCheckoutUnavailableError();const {targetType,...order}=row;void targetType;return order;}
/** Preparation only. Hosted mode requires an explicit TEST merchant and a matching account. */
export class PostgresApplicationCheckoutStore{
 private readonly apps:PostgresApplicationStore;private readonly intents:PostgresPaymentIntentStore;
 private readonly shopId:string;
 private readonly vatCode:number;
 private readonly admittedOwner:string|null;
 constructor(private readonly db:Pick<PostgresDatabase,'transaction'>,private readonly delivery:((id:string)=>Promise<string|null>)|null,private readonly recover?:(token:string,owner:string,id:string)=>Promise<void>,hosted?:'account-response-test'){
  if(typeof window!=='undefined'||!readPostmoderationEnabled())throw new ApplicationCheckoutUnavailableError();
  if(hosted===undefined){
   if(process.env.NODE_ENV!=='test'||!delivery)throw new ApplicationCheckoutUnavailableError();
   this.shopId='local-fixture-shop';this.vatCode=1;this.admittedOwner=null;
  }else{
   const config=hosted==='account-response-test'&&readApplicationAccountTest();
   if(!config||!config.checkout.receiptVatCode)throw new ApplicationCheckoutUnavailableError();
   this.shopId=config.merchant.shopId;this.vatCode=config.checkout.receiptVatCode;this.admittedOwner=config.merchant.ownerId;
  }
  this.apps=new PostgresApplicationStore(db,{vacancyPostmoderation:true,specialistApplicationReady:true,localActions:true});this.intents=new PostgresPaymentIntentStore(db);
 }
 private get admissionFilter(){
  return this.admittedOwner===null?'':' and exists(select 1 from app_response.admissions admitted where admitted.intent_id=i.id and admitted.applicant_id=i.owner_id and admitted.shop_id=i.merchant_shop_id)';
 }
 private owner<T>(token:string,owner:string,work:(tx:PostgresQueries,actor:string)=>Promise<T>){const expected=parseListingDraftId(owner);return withAppSessionTransaction(this.db,token,(tx,user)=>{if(user.id!==expected||(this.admittedOwner!==null&&user.id!==this.admittedOwner))throw new AppSessionAccessError();return work(tx,user.id);});}
 private async offer(tx:PostgresQueries):Promise<Offer>{const row=(await tx.query<Offer>("select id,name,price::text as amount,'RUB' as currency,duration_days as \"durationDays\" from app.tariffs where id='job-response' and action='job_response' and active and price>0 and duration_days is null")).rows[0];if(!row)throw new ApplicationCheckoutUnavailableError();return row;}
 private async keyed(tx:PostgresQueries,owner:string,key:string){return(await tx.query<OrderRow>(`select ${columns} ${source}${this.admissionFilter} and o.owner_id=$1 and o.creation_key=$2`,[owner,key,this.shopId])).rows[0];}
 private async active(tx:PostgresQueries,owner:string,id:string){return(await tx.query<OrderRow>(`select ${columns} ${source}${this.admissionFilter} and o.owner_id=$1 and o.target_id=$2 and o.status in ('created','pending','succeeded')`,[owner,id,this.shopId])).rows[0];}
 preview(token:string,owner:string,value:unknown,expected:unknown){const id=parseListingDraftId(value),revision=parseListingDraftRevision(expected);return this.owner(token,owner,async(tx,actor)=>{
  await this.apps.inspectCheckoutInTransaction(tx,actor,id,revision);const tariff=await this.offer(tx),active=await this.active(tx,actor,id);return{applicationId:id,revision,tariff,activePayment:active?display(active):null};
 });}
 readIntent(token:string,owner:string,value:unknown){const key=parseListingDraftId(value);return this.owner(token,owner,async(tx,actor)=>{const row=await this.keyed(tx,actor,key);return row?display(row):null;});}
 async readOrder(token:string,owner:string,value:unknown){const id=parseListingDraftId(value),read=()=>this.owner(token,owner,async(tx,actor)=>{
  const row=(await tx.query<OrderRow>(`select ${columns} ${source}${this.admissionFilter} and o.id=$1 and o.owner_id=$2`,[id,actor,this.shopId])).rows[0];if(!row)return null;
  const closed=await tx.query(`select w.id from app.work_publications w join app.applications a on a.work_publication_id=w.id
   where a.id=$1 and a.applicant_id=$2 and w.kind='workRequest' and exists(select 1 from app.applications chosen
    where chosen.work_publication_id=w.id and chosen.status='selected' and chosen.is_paid and chosen.sent_at is not null)`,[row.targetId,actor]);
  const deliveredAt=this.admittedOwner===null?null:(await tx.query<{sent:string|null}>(
   'select app_response.read_delivery($1,$2) as sent',[id,hashSessionToken(token)])).rows[0]?.sent??null;
  return{order:display(row),targetClosed:closed.rowCount===1,deliveredAt};
 });const initial=await read();if(!initial)return null;
  // Trusted local recovery reads the original simulator payment only. Reauthorize
  // and reread after reconciliation; never return a stale pre-recovery status.
  if(this.recover)await this.recover(token,owner,id);
  const snapshot=this.recover?await read():initial;return snapshot&&this.admittedOwner===null&&this.delivery?{...snapshot,deliveredAt:await this.delivery(id)}:snapshot;}
 prepare(token:string,owner:string,value:unknown){const input=parseApplicationCheckout(value);return this.owner(token,owner,async(tx,actor)=>{
  const prior=await this.keyed(tx,actor,input.creationKey);
  if(prior){if(prior.targetId!==input.applicationId||prior.targetRevision!==input.expectedRevision||prior.tariffId!==input.expectedTariffId||prior.amount!==input.expectedAmount)throw new ApplicationCheckoutConflictError();return display(prior);}
  await this.apps.inspectCheckoutInTransaction(tx,actor,input.applicationId,input.expectedRevision);const offer=await this.offer(tx);
  if(offer.id!==input.expectedTariffId||offer.amount!==input.expectedAmount||await this.active(tx,actor,input.applicationId))throw new ApplicationCheckoutConflictError();
  const id=randomUUID(),amount={value:offer.amount,currency:'RUB'},description='Отклик на вакансию или заказ';
  const payer=(await tx.query<{email:string}>('select email from app.users where id=$1 and email_verified_at is not null and not is_blocked',[actor])).rows[0];if(!payer)throw new AppSessionAccessError();
  const intent=parsePaymentIntent({id,ownerId:actor,targetType:'application',targetId:input.applicationId,targetRevision:input.expectedRevision,tariffId:offer.id,amount:offer.amount,durationDays:null,shopId:this.shopId,isTest:true,
   requestBody:JSON.stringify({amount,capture:true,description,confirmation:{type:'redirect',return_url:`https://xn----9sbphbgks4a4a.xn--p1ai/oplata/${id}?type=application`},metadata:{localPaymentId:id,targetId:input.applicationId,targetType:'application',tariffId:offer.id},receipt:{customer:{email:payer.email},internet:true,items:[{amount,description,payment_mode:'full_payment',payment_subject:'service',quantity:1,vat_code:this.vatCode}]}})});
  const inserted=await tx.query("insert into app.payment_orders(id,owner_id,creation_key,target_type,target_id,target_revision) values($1,$2,$3,'application',$4,$5::bigint) on conflict do nothing returning id",[id,actor,input.creationKey,input.applicationId,input.expectedRevision]);
  if(inserted.rowCount!==1)throw new ApplicationCheckoutConflictError();await this.intents.persistInTransaction(tx,intent);
  if(this.admittedOwner!==null){
   const result=await tx.query<{admitted:boolean}>('select app_response.admit($1,$2) as admitted',[id,hashSessionToken(token)]);
   if(result.rows[0]?.admitted!==true)throw new ApplicationCheckoutUnavailableError();
  }
  const saved=await this.keyed(tx,actor,input.creationKey);if(!saved)throw new ApplicationCheckoutUnavailableError();return display(saved);
 });}
 authorizeDispatch(token:string,owner:string,value:unknown,requireCurrent=false):Promise<PaymentIntentBinding>{const id=parseListingDraftId(value);return this.owner(token,owner,async(tx,actor)=>{
  const row=(await tx.query<PaymentIntent&{status:string}>(`select i.id,i.owner_id as "ownerId",i.target_type as "targetType",i.target_id as "targetId",i.target_revision::text as "targetRevision",i.tariff_id as "tariffId",i.amount::text,i.duration_days as "durationDays",i.merchant_shop_id as "shopId",i.is_test as "isTest",i.request_body as "requestBody",o.status from app.payment_orders o join app.payment_checkout_intents i on i.id=o.id and i.owner_id=o.owner_id and i.target_type=o.target_type and i.target_id=o.target_id and i.target_revision=o.target_revision where o.id=$1 and o.owner_id=$2 and o.target_type='application' and i.merchant_shop_id=$3 and i.is_test${this.admissionFilter}`,[id,actor,this.shopId])).rows[0];
  if(!row)throw new ApplicationAccessError();const {status,...stored}=row,intent=parsePaymentIntent(stored);
  if(requireCurrent&&!(await tx.query('select intent_id from app.payment_provider_links where intent_id=$1',[id])).rowCount){
   if(this.admittedOwner!==null){
    const current=await tx.query<{allowed:boolean}>('select app_response.authorized_for_dispatch($1,$2) as allowed',[id,hashSessionToken(token)]);
    if(current.rows[0]?.allowed!==true)throw new ApplicationCheckoutUnavailableError();
   }
   if(status!=='created')throw new ApplicationCheckoutUnavailableError();await this.apps.inspectCheckoutInTransaction(tx,actor,intent.targetId,intent.targetRevision);const offer=await this.offer(tx);if(offer.id!==intent.tariffId||offer.amount!==intent.amount||intent.durationDays!==null)throw new ApplicationCheckoutConflictError();
  }
  const {requestBody,...binding}=intent;void requestBody;return binding;
 });}
}
