import {PostgresPaymentIntentStore} from './postgres-payment-intents';
import {PostgresApplicationStore,ApplicationConflictError,ApplicationAccessError,ApplicationEligibilityError} from './postgres-applications';
import {PostgresPublicWorkStore} from './postgres-public-work';
import {enqueueNotificationInTransaction} from './postgres-notification-inbox';
import {readPostmoderationEnabled} from './listing-workflow-config';
import {parseListingDraftId} from './listing-draft-contract.ts';
import type {PostgresDatabase} from './postgres';
/** Trusted loopback simulator only. No runtime grants, external calls or production installation. */
export class PostgresApplicationFulfillmentStore{
 constructor(private readonly db:Pick<PostgresDatabase,'transaction'>){if(typeof window!=='undefined'||process.env.NODE_ENV!=='test'||!readPostmoderationEnabled())throw new ApplicationConflictError();}
 fulfill(value:unknown){const id=parseListingDraftId(value);return this.db.transaction(async tx=>{
  const user=(await tx.query<{id:string;blocked:boolean;verified:boolean}>("select id,is_blocked as blocked,email_verified_at is not null as verified from app.users where id=(select owner_id from app.payment_checkout_intents where id=$1) for update",[id])).rows[0];
  const intent=await new PostgresPaymentIntentStore(this.db).lockKnownInTransaction(tx,id);
  if(intent.targetType!=='application'||intent.shopId!=='local-fixture-shop'||!intent.isTest||intent.durationDays!==null||intent.tariffId!=='job-response')throw new ApplicationConflictError();
  const order=(await tx.query<{status:string}>('select status from app.payment_orders where id=$1 for update',[id])).rows[0];
  if(order?.status!=='succeeded')return{state:'blocked',reason:'capture_required'};
  const existing=(await tx.query('select intent_id from local_primary.application_deliveries where intent_id=$1',[id])).rowCount;
  if(existing)return{state:'fulfilled',reason:'already_delivered'};
  const verified=(await tx.query<{status:string;capturedAt:string|null;providerId:string}>('select status,captured_at as "capturedAt",provider_payment_id as "providerId" from app.payment_verifications where intent_id=$1',[id])).rows[0];
  if(!verified||verified.status!=='succeeded'||!verified.capturedAt||verified.providerId!==intent.providerPaymentId)return{state:'blocked',reason:'capture_required'};
  if(!user||user.id!==intent.ownerId||user.blocked||!user.verified)return{state:'blocked',reason:'account_unavailable'};
  const apps=new PostgresApplicationStore(this.db,{vacancyPostmoderation:true,specialistApplicationReady:true,localActions:true});
  let inspected:Awaited<ReturnType<typeof apps.inspectCheckoutInTransaction>>;
  try{inspected=await apps.inspectCheckoutInTransaction(tx,intent.ownerId,intent.targetId,intent.targetRevision);}catch(error){
   if(error instanceof ApplicationConflictError||error instanceof ApplicationAccessError||error instanceof ApplicationEligibilityError)return{state:'blocked',reason:'application_or_target_changed'};
   throw error;
  }
  const {row,current}=inspected;
  // Only this trusted worker has financial locking rights. NOWAIT avoids crossing another publisher's lock order.
  await tx.query(`select id from app.cities where id in (select city_id from app.work_publications where id=$1 union select city_id from app.service_publications where id=$2) order by id for share nowait`,[row.targetId,current.specialist.id]);
  await tx.query(`select id from app.specialist_categories where id in (select profession_id from app.work_publications where id=$1 union select profession_id from app.service_publications where id=$2) order by id for share nowait`,[row.targetId,current.specialist.id]);
  await tx.query("select o.id from app.payment_orders o join app.payment_checkout_intents i on i.id=o.id where i.target_id=$1 and i.target_type=$2 for share of o nowait",[row.targetId,row.kind]);
  const publicWork=new PostgresPublicWorkStore(tx,{vacancyPostmoderation:true});
  const valid=async()=>!!await publicWork.read(row.kind,row.targetId)&&(await tx.query(`select s.id from app.service_publications s join app.cities c on c.id=s.city_id and c.name=s.form->>'cityName' join app.specialist_categories p on p.id=s.profession_id and p.active and p.name=s.form->>'professionName' where s.id=$1 and s.author_id=$2 and s.deleted_at is null`,[current.specialist.id,intent.ownerId])).rowCount===1;
  if(!await valid())return{state:'blocked',reason:'content_unavailable'};
  const delivered=(await tx.query<{sentAt:string}>(`update app.applications set is_paid=true,status='sent',sent_at=clock_timestamp(),revision=revision+1,updated_at=clock_timestamp()
   where id=$1 and applicant_id=$2 and revision=$3::bigint and revision<9223372036854775807 and not is_paid and sent_at is null and status='pending_payment'
   and not exists(select 1 from app.application_withdrawals x where x.application_id=app.applications.id)
   returning to_char(sent_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "sentAt"`,[row.id,intent.ownerId,intent.targetRevision])).rows[0];
  if(!delivered)throw new ApplicationConflictError();
  await tx.query('insert into local_primary.application_deliveries(intent_id,application_id,sent_at) values($1,$2,$3::timestamptz)',[id,row.id,delivered.sentAt]);
  await enqueueNotificationInTransaction(tx,row.targetOwner,{eventKey:`application_paid:${row.id}`,category:'message',tone:'info',title:'Новый отклик',body:`На ${row.kind==='vacancy'?'вашу вакансию':'ваш заказ'} поступил отклик. Анкета и контакты доступны в кабинете.`,actionHref:'/cabinet/otkliki',bookingRequestId:null});
  if(!await valid())throw new ApplicationConflictError();return{state:'fulfilled',reason:'delivered'};
 });}
}
