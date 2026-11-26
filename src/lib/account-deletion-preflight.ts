import {deletionId,deletionRevision,DeletionInputError} from './account-deletion-contract.ts';
import type {PostgresQueries} from './postgres';
import {readAccountListingViews} from './listing-view-history.ts';

export const deletionPreflightFields=['profiles','sessions','authRecords','publications','applications','bookings','listingViews','media','mail','payments','refunds','compensations','externalAudit','caseAudit',
 'notifications','businessMail','pushSubscriptions','pushDeliveries',
 'openPayments','openRefunds','openCompensations','openBookings','openUploads','openMail','openPush'] as const;
type Field=typeof deletionPreflightFields[number];
type Counts=Record<Field,string>;
export class DeletionPreflightUnavailableError extends Error{constructor(){super('Deletion preflight unavailable');this.name='DeletionPreflightUnavailableError';}}
export class DeletionPreflightCaseError extends Error{constructor(){super('Deletion case unavailable or changed');this.name='DeletionPreflightCaseError';}}
function count(value:unknown):string{
 if(typeof value!=='string'||!/^(0|[1-9][0-9]{0,18})$/.test(value)||BigInt(value)>BigInt('9223372036854775807'))throw new DeletionPreflightUnavailableError();return value;
}
const operations={openPayments:'PAYMENT_UNSETTLED',openRefunds:'REFUND_UNSETTLED',openCompensations:'COMPENSATION_UNSETTLED',openBookings:'BOOKING_OPEN',openUploads:'UPLOAD_UNSETTLED',openMail:'MAIL_IN_FLIGHT',openPush:'PUSH_IN_FLIGHT'} as const;
type BlockerCode=typeof operations[keyof typeof operations]|'PRIVILEGED_ACCOUNT';
const retained={payments:'FINANCIAL_HISTORY',refunds:'REFUND_HISTORY',compensations:'COMPENSATION_HISTORY',applications:'CROSS_PARTY_APPLICATIONS',bookings:'BOOKING_HISTORY',listingViews:'LISTING_VIEW_HISTORY',publications:'PUBLICATION_DATA',media:'MEDIA_AND_REFERENCE_HISTORY',externalAudit:'IMMUTABLE_AUDIT'} as const;
/** Advisory routing only. A count snapshot is never permission to erase or an assigned retention policy. */
export function classifyDeletionPreflight(input:unknown,role:unknown){
 if(!input||typeof input!=='object'||Array.isArray(input)||Reflect.ownKeys(input).length!==deletionPreflightFields.length||
  deletionPreflightFields.some(key=>!Object.hasOwn(input,key))||(role!=='user'&&role!=='admin'))throw new DeletionPreflightUnavailableError();
 const counts=Object.fromEntries(deletionPreflightFields.map(key=>[key,count((input as Record<string,unknown>)[key])])) as Counts;
 const blockers:Array<{code:BlockerCode;count:string}>=Object.entries(operations).filter(([key])=>counts[key as Field]!=='0').map(([key,code])=>({code,count:counts[key as Field]}));
 if(role==='admin')blockers.push({code:'PRIVILEGED_ACCOUNT',count:'1'});
 const retentionReview=Object.entries(retained).filter(([key])=>counts[key as Field]!=='0').map(([key,code])=>({code,count:counts[key as Field]}));
 return{counts,blockers,retentionReview,decision:blockers.length?'manual-review':retentionReview.length?'storage-policy-review':'no-operational-blocker',executionAuthorized:false as const};
}

const optionalAudit=[
 ['app_admin.user_changes','actor_id=$1 or target_id=$1'],
 ['app_admin.tariff_changes','actor_id=$1'],
 ['app.payment_checkout_cancellations','owner_id=$1'],
 ['app.payment_refund_recovery_actions','operator_id=$1'],
 ['app.application_contact_views','recipient_id=$1'],
 ['app.application_selection_events','recipient_id=$1'],
] as const;
const optionalPairs=[
 ['app.payment_refund_reservations','app.payment_refund_effects'],
 ['app.application_compensation_cases','app.application_compensation_refunds'],
 ['app.media_retirement_requests','app.media_retirement_completions'],
] as const;
const businessMailTable='notification_delivery.business_email',pushSubscriptionsTable='app_push.subscriptions',pushDeliveriesTable='app_push.deliveries';
const optionalRelations=[...optionalPairs.flat(),...optionalAudit.map(([table])=>table),'app_stats.listing_views',
 businessMailTable,pushSubscriptionsTable,pushDeliveriesTable];

function factsSql(installed:ReadonlySet<string>){
 const [refunds,compensations,mediaRetirement]=optionalPairs.map(([first,second])=>{
  const available=installed.has(first);
  if(available!==installed.has(second))throw new DeletionPreflightUnavailableError();
  return available;
 });
 const pushSubscriptions=installed.has(pushSubscriptionsTable);
 if(installed.has(pushDeliveriesTable)&&!pushSubscriptions)throw new DeletionPreflightUnavailableError();
 const deliveries=(table:string)=>installed.has(table)
  ?'select d.state from '+table+' d join owned_notifications n on n.id=d.notification_id'
  :'select null::text as state where false';
 const extraAudit=optionalAudit.filter(([table])=>installed.has(table))
  .map(([table,predicate])=>`+(select count(*) from ${table} where ${predicate})`).join('');
 return `with owned_targets as (
 select id,'listing'::text target_type from app.listings where author_id=$1
 union all select id,kind from app.work_publications where author_id=$1
 union all select id,case kind when 'fair' then 'fair_application' when 'marquee' then 'ad_marquee' else kind end from app.service_publications where author_id=$1
), related_applications as (
 select a.id from app.applications a left join app.work_publications w on w.id=a.work_publication_id
 left join app.service_publications s on s.id=a.specialist_publication_id where a.applicant_id=$1 or w.author_id=$1 or s.author_id=$1
), related_payments as (
 select coalesce(i.id,o.id) id,coalesce(i.target_type,o.target_type) target_type,coalesce(i.target_id,o.target_id) target_id,o.status,
  (i.id is null or o.id is null or row(i.owner_id,i.target_type,i.target_id,i.target_revision) is distinct from row(o.owner_id,o.target_type,o.target_id,o.target_revision)) inconsistent
 from app.payment_checkout_intents i full join app.payment_orders o on o.id=i.id
 where i.owner_id=$1 or o.owner_id=$1 or exists(select 1 from owned_targets t where (t.id=i.target_id and t.target_type=i.target_type) or (t.id=o.target_id and t.target_type=o.target_type))
  or exists(select 1 from related_applications a where (i.target_type='application' and i.target_id=a.id) or (o.target_type='application' and o.target_id=a.id))
), related_refunds as (
 ${refunds?'select r.id,r.payment_intent_id from app.payment_refund_reservations r join related_payments p on p.id=r.payment_intent_id':
 'select null::uuid as id,null::uuid as payment_intent_id where false'}
), related_compensations as (
 ${compensations?`select c.payment_intent_id from app.application_compensation_cases c where c.payment_intent_id in(select id from related_payments)
  or c.application_id in(select id from related_applications)`:'select null::uuid as payment_intent_id where false'}
), related_bookings as (
 select b.* from app.booking_requests b where b.guest_id=$1 or b.host_id=$1 or b.cancelled_by=$1 or b.listing_id in(select id from owned_targets where target_type='listing')
), owned_media as (select id,state from app.media_objects where owner_id=$1),
owned_notifications as(select id from app.notifications where user_id=$1),
business_mail as(${deliveries(businessMailTable)}),
push_deliveries as(${deliveries(pushDeliveriesTable)})
select
 (select count(*)::text from app.cabinet_profiles where user_id=$1) as profiles,
 (select count(*)::text from app.sessions where user_id=$1) as sessions,
 ((select count(*) from app.email_confirmations where user_id=$1)+(select count(*) from app.password_recoveries where user_id=$1)+
  (select count(*) from app.registration_legal where user_id=$1)+(select count(*) from app.telegram_phone_attempts where user_id=$1)+
  (select count(*) from app.telegram_phone_bindings where user_id=$1))::text as "authRecords",
 (select count(*)::text from owned_targets) as publications,(select count(*)::text from related_applications) as applications,
 (select count(*)::text from related_bookings) as bookings,(select count(*)::text from owned_media) as media,
 (select count(*)::text from owned_notifications) as notifications,
 (select count(*)::text from business_mail) as "businessMail",
 ${pushSubscriptions?'(select count(*)::text from app_push.subscriptions d join app.sessions s on s.token_hash=d.session_hash where s.user_id=$1)':"'0'::text"} as "pushSubscriptions",
 (select count(*)::text from push_deliveries) as "pushDeliveries",
 (select count(*)::text from app.mail_outbox where user_id=$1) as mail,(select count(*)::text from related_payments) as payments,
 (select count(*)::text from related_refunds) as refunds,(select count(*)::text from related_compensations) as compensations,
 ((select count(*) from app.listing_blocks where blocked_by=$1)+(select count(*) from app.listing_moderation where decided_by=$1)+
  (select count(*) from app.work_moderation where decided_by=$1)+(select count(*) from app.service_moderation where decided_by=$1)+
  (select count(*) from app.work_owner_actions where owner_id=$1)+(select count(*) from app.booking_events where actor_id=$1)
  ${extraAudit})::text as "externalAudit",
 (select count(*)::text from app.account_deletion_events e left join app.account_deletion_requests r on r.id=e.request_id where r.user_id=$1 or e.actor_id=$1) as "caseAudit",
 (select count(*)::text from related_payments p where inconsistent or status in ('created','pending') or status='succeeded' and
  case when target_type='application' then not exists(select 1 from app.applications a where a.id=p.target_id and a.is_paid and a.sent_at is not null)
  else not exists(select 1 from app.payment_fulfillments f where f.intent_id=p.id) end) as "openPayments",
 (select count(*)::text from related_refunds r where ${refunds?'not exists(select 1 from app.payment_refund_effects e where e.operation_id=r.id)':'true'}
  ${compensations?'and not exists(select 1 from app.application_compensation_refunds c where c.payment_intent_id=r.payment_intent_id)':''}) as "openRefunds",
 (select count(*)::text from related_compensations c
  ${compensations?'where not exists(select 1 from app.application_compensation_refunds r where r.payment_intent_id=c.payment_intent_id)':''}) as "openCompensations",
 (select count(*)::text from related_bookings where status in ('pending','accepted')) as "openBookings",
 (select count(*)::text from owned_media m where state='pending'
  ${mediaRetirement?'and not exists(select 1 from app.media_retirement_completions c where c.media_id=m.id)':''}) as "openUploads",
 ((select count(*) from app.mail_outbox where user_id=$1 and state in ('reserved','sending','unknown'))+
  (select count(*) from business_mail where state in ('sending','unknown')))::text as "openMail",
 (select count(*)::text from push_deliveries where state in ('sending','unknown')) as "openPush"`;
}

/** Caller supplies a bounded, owned-local repeatable-read transaction. No writes or session touching. */
export async function inspectAccountDeletionCase(tx:PostgresQueries,caseId:unknown,expectedRevision:unknown,
 {listingViewRateSecret}:{listingViewRateSecret?:string}={}){
 const id=deletionId(caseId),revision=deletionRevision(expectedRevision);
 try{
  const context=(await tx.query<{readonly:string;isolation:string}>("select current_setting('transaction_read_only') as readonly,current_setting('transaction_isolation') as isolation")).rows[0];
  if(context?.readonly!=='on'||context.isolation!=='repeatable read')throw new DeletionPreflightUnavailableError();
  const subject=(await tx.query<{id:string;revision:string;status:string;subjectId:string;role:string;blocked:boolean;authVersion:string;observedAt:string}>(`select r.id,r.revision::text,r.status,u.id as "subjectId",u.role,u.is_blocked as blocked,u.auth_version::text as "authVersion",
   to_char(transaction_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "observedAt"
   from app.account_deletion_requests r join app.users u on u.id=r.user_id where r.id=$1`,[id])).rows[0];
  if(!subject||subject.revision!==revision||!['requested','in_review'].includes(subject.status))throw new DeletionPreflightCaseError();
  const subjectId=deletionId(subject.subjectId),authVersion=count(subject.authVersion);
  if(typeof subject.blocked!=='boolean'||typeof subject.observedAt!=='string'||!Number.isFinite(Date.parse(subject.observedAt)))throw new DeletionPreflightUnavailableError();
  const relations=(await tx.query<{name:string}>(`select name from unnest($1::text[]) as known(name)
   where to_regclass(name) is not null`,[optionalRelations])).rows;
  const installed=new Set(relations.map(row=>row.name));
  const facts=(await tx.query<Record<string,unknown>>(factsSql(installed),[subjectId])).rows[0];
  const listingViews=installed.has('app_stats.listing_views')?(await readAccountListingViews(tx,subjectId,listingViewRateSecret)).length:0;
  const result=classifyDeletionPreflight({...facts,listingViews:String(listingViews)},subject.role);
  return{version:1,requestId:id,requestRevision:revision,subject:{id:subjectId,authVersion,role:subject.role,blocked:subject.blocked},observedAt:subject.observedAt,...result};
 }catch(error){if(error instanceof DeletionInputError||error instanceof DeletionPreflightCaseError)throw error;throw new DeletionPreflightUnavailableError();}
}
