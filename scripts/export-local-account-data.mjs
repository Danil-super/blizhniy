// Account data snapshots never refresh the session. The CLI below remains synthetic-only.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {lstat,mkdtemp,readFile,mkdir,realpath,rm,writeFile} from 'node:fs/promises';
import {basename,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import pg from 'pg';
import {docker,localPrimaryDatabaseConfig,stateDirectory,stateFile} from './local-primary-fixture.mjs';
import {readLocalPrimaryState,validateLocalPrimaryContainer} from './local-primary-config.mjs';
import {archiveRoot,localArchiveMaximumBytes,privateDirectory,publishLocalAccountArchive,readBoundedExportFile,revokeLocalAccountArchive} from './local-account-export-delivery.mjs';
import {prepareLocalAccountEmail,readReviewedAccountReport,writeAccountReport,writeLocalAccountReport} from './local-account-export-report.mjs';

const load=createRequire(import.meta.url)('./local-primary-modules.cjs').loadLocalPrimaryModule;
const {DeletionAccessError,deletionId,deletionObject}=load('account-deletion-contract');
const {hashSessionToken}=load('identity');
const {readAccountListingViews}=load('listing-view-history');
const exportBatchSize=500;
const records={
 consents:'select document,version,recorded_at from app.registration_legal where user_id=$1 order by document',
 sessions:'select scope,created_at,expires_at,last_seen_at from app.sessions where user_id=$1 order by created_at,scope',
 emailConfirmations:'select created_at,expires_at from app.email_confirmations where user_id=$1',
 passwordRecoveries:'select created_at,expires_at from app.password_recoveries where user_id=$1',
 phoneBindings:'select phone,source,confirmed_at from app.telegram_phone_bindings where user_id=$1 order by confirmed_at',
 phoneVerification:'select state,created_at,expires_at from app.telegram_phone_attempts where user_id=$1 order by created_at,id',
 mail:'select purpose,state,created_at,expires_at from app.mail_outbox where user_id=$1 order by created_at,id',
 listings:`select id,listing_type,category_id,city_id,title,description,price::text,district,address,latitude::text,longitude::text,
  show_exact_address,contact_phone,messenger_url,contact_method,booking,status,is_paid,view_count,revision::text,created_at,updated_at,published_at,expires_at
  from app.listings where author_id=$1 order by created_at,id`,
 work:`select id,kind,form,city_id,profession_id,revision::text,status,is_paid,created_at,updated_at,published_at,expires_at,deleted_at
  from app.work_publications where author_id=$1 order by created_at,id`,
 services:`select id,kind,form,city_id,profession_id,revision::text,status,is_paid,created_at,updated_at,published_at,expires_at,deleted_at
  from app.service_publications where author_id=$1 order by created_at,id`,
 publicationReviews:`select kind,publication_id,revision::text,state,submitted_at,decided_at,decision_note from (
  select 'listing' as kind,m.listing_id as publication_id,m.revision,m.state,m.submitted_at,m.decided_at,m.decision_note
  from app.listing_moderation m join app.listings l on l.id=m.listing_id where l.author_id=$1
  union all
  select 'work',m.publication_id,m.revision,m.state,m.submitted_at,m.decided_at,m.decision_note
  from app.work_moderation m join app.work_publications w on w.id=m.publication_id where w.author_id=$1
  union all
  select 'service',m.publication_id,m.revision,m.state,m.submitted_at,m.decided_at,m.decision_note
  from app.service_moderation m join app.service_publications s on s.id=m.publication_id where s.author_id=$1
 ) as reviews order by kind,publication_id,reviews.revision`,
 listingBlocks:`select b.listing_id,b.blocked_revision::text,b.reason,b.blocked_at
  from app.listing_blocks b join app.listings l on l.id=b.listing_id where l.author_id=$1 order by b.blocked_at,b.listing_id`,
 listingRemovals:`select r.listing_id,r.removed_revision::text,r.removed_at
  from app.listing_owner_removals r join app.listings l on l.id=r.listing_id
  where r.owner_id=$1 and l.author_id=$1 order by r.removed_at,r.listing_id`,
 workOwnerActions:`select a.publication_id,a.kind,a.expected_revision::text,a.action,a.reason,a.resulting_revision::text,a.status,a.occurred_at
  from app.work_owner_actions a join app.work_publications w on w.id=a.publication_id
  where a.owner_id=$1 and w.author_id=$1 order by a.occurred_at,a.publication_id,a.resulting_revision`,
 applications:`select a.id,a.work_publication_id,a.specialist_publication_id,case when a.applicant_id=$1 then 'applicant' else 'recipient' end as side,
  case when a.applicant_id=$1 then a.message end as message,case when a.applicant_id=$1 then a.snapshot end as profile,
  a.status,a.is_paid,a.sent_at,a.created_at,a.updated_at,a.revision::text
  from app.applications a join app.work_publications w on w.id=a.work_publication_id
  where a.applicant_id=$1 or (w.author_id=$1 and a.is_paid and a.sent_at is not null) order by a.created_at,a.id`,
 applicationWithdrawals:`select r.application_id,r.withdrawn_revision::text,r.withdrawn_at
  from app.application_withdrawals r join app.applications a on a.id=r.application_id
  where r.owner_id=$1 and a.applicant_id=$1 order by r.withdrawn_at,r.application_id`,
 bookings:`select id,listing_id,case when guest_id=$1 then 'guest' else 'host' end as side,mode,start_date::text,end_date::text,
  guests,total::text,status,revision::text,created_at,updated_at,decided_at,starts_at,expires_at,
  case when cancelled_by=$1 then cancellation_reason end as cancellation_reason
  from app.booking_requests where guest_id=$1 or host_id=$1 order by created_at,id`,
 bookingEvents:`select e.booking_id,e.revision::text,e.status,e.actor_id=$1 as actor_is_owner,
  case when e.actor_id=$1 then e.reason end as reason,e.origin,e.created_at
  from app.booking_events e join app.booking_requests b on b.id=e.booking_id
  where b.guest_id=$1 or b.host_id=$1 order by e.booking_id,e.revision`,
 notifications:`select id,category,tone,title,body,action_href,read_at,dismissed_at,created_at from app.notifications
  where user_id=$1 order by created_at,id`,
 deletionRequests:`select id,status,revision::text,requested_at,review_started_at,resolved_at,resolution
  from app.account_deletion_requests where user_id=$1 order by requested_at,id`,
 deletionEvents:`select e.request_id,e.status,e.resolution,e.actor_id=$1 as actor_is_owner,e.created_at
  from app.account_deletion_events e join app.account_deletion_requests r on r.id=e.request_id
  where r.user_id=$1 order by e.created_at,e.id`,
 media:`select id,mime_type as "mimeType",width,height,size,sha256,state,created_at,ready_at
  from app.media_objects where owner_id=$1 order by created_at,id`,
 listingPhotos:`select ph.listing_id,ph.media_id,ph.position from app.listing_photos ph
  join app.listings l on l.id=ph.listing_id join app.media_objects m on m.id=ph.media_id
  where l.author_id=$1 and m.owner_id=$1 order by ph.listing_id,ph.position`,
 workPhotos:`select ph.publication_id,ph.media_id,ph.position from app.work_publication_photos ph
  join app.work_publications p on p.id=ph.publication_id join app.media_objects m on m.id=ph.media_id
  where p.author_id=$1 and m.owner_id=$1 order by ph.publication_id,ph.position`,
 servicePhotos:`select ph.publication_id,ph.media_id,ph.position from app.service_publication_photos ph
  join app.service_publications p on p.id=ph.publication_id join app.media_objects m on m.id=ph.media_id
  where p.author_id=$1 and m.owner_id=$1 order by ph.publication_id,ph.position`,
};
const applicationProfileKeys=['name','profession','price','skills','about','phone','email','messengerUrl'];
const verifiedSession=`from app.users u join app.sessions s on s.user_id=u.id and s.auth_version=u.auth_version
 where s.token_hash=$1 and u.id=$2 and u.email_verified_at is not null and s.scope in ('app','data-subject')
 and s.expires_at>clock_timestamp() and s.last_seen_at>clock_timestamp()-interval '30 minutes'`;
const verifiedOperator=`from app.users u where u.id=$2 and u.email_verified_at is not null
 and exists(select 1 from app.users actor join app.sessions s on s.user_id=actor.id and s.auth_version=actor.auth_version
  where actor.id=$3 and actor.id<>u.id and actor.role='admin' and not actor.is_blocked and actor.email_verified_at is not null
  and s.token_hash=$1 and s.scope='app' and s.expires_at>clock_timestamp()
  and s.last_seen_at>clock_timestamp()-interval '30 minutes')`;

export async function readAccountExport(db,token,confirmedOwnerId,operatorId,{listingViewRateSecret}={}){
 assert.equal(process.env.NODE_ENV,'test');
 return readAccountSnapshot(db,token,confirmedOwnerId,operatorId,listingViewRateSecret);
}

export async function readApprovedProductionAccountExport(db,token,value,{listingViewRateSecret}={}){
 const approval=deletionObject(value,['caseId','ownerId','operatorId','emailSha256']);
 assert.match(approval.caseId,/^[A-Za-z0-9_-]{6,80}$/);
 assert.match(approval.emailSha256,/^[a-f0-9]{64}$/);
 const data=await readAccountSnapshot(db,token,approval.ownerId,deletionId(approval.operatorId),listingViewRateSecret,approval.emailSha256);
 return {caseId:approval.caseId,data};
}

const productionReaderContext=`select true as reader,
 current_database()='blizhniy_prod' and current_user=session_user and current_user='blizhniy_account_export_reader'
 and current_setting('transaction_read_only')='on' and current_setting('transaction_isolation')='repeatable read'
 and exists(select 1 from pg_roles r where r.rolname=current_user and r.rolcanlogin
  and not (r.rolsuper or r.rolinherit or r.rolcreatedb or r.rolcreaterole or r.rolreplication or r.rolbypassrls)
  and not exists(select 1 from pg_auth_members m where m.member=r.oid)) as allowed`;

async function readAccountSnapshot(db,token,confirmedOwnerId,operatorId,listingViewRateSecret,emailSha256){
 const ownerId=deletionId(confirmedOwnerId),hash=hashSessionToken(token);
 if(!hash)throw new DeletionAccessError();
 const credentials=operatorId===undefined?[hash,ownerId]:[hash,ownerId,deletionId(operatorId)];
 const access=operatorId===undefined?verifiedSession:verifiedOperator;
 const timeoutMs=5000,options={timeoutMs,deadline:performance.now()+timeoutMs};
 const data=await db.readTransaction(async tx=>{
  const context=(await tx.query(emailSha256?productionReaderContext:`select current_user='blizhniy_local_export_reader' as reader,current_user=session_user and (
    (current_user='postgres' and current_database() in ('blizhniy_test','blizhniy_prod','blizhniy_erasure_test'))
    or (current_user='blizhniy_local_export_reader' and current_database()='blizhniy_test'))
    and current_setting('transaction_read_only')='on' and current_setting('transaction_isolation')='repeatable read' as allowed`)).rows[0];
  assert.equal(context?.allowed,true);
  const account=(await tx.query(`select u.id,u.email,u.is_blocked as "isBlocked",u.email_verified_at,u.created_at,
    to_char(transaction_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as snapshot
    ${access}`,credentials)).rows[0];
  if(!account||emailSha256&&createHash('sha256').update(account.email).digest('hex')!==emailSha256)
   throw new DeletionAccessError();
  if(context.reader)await tx.query("select set_config('blizhniy.account_export_owner',$1,true)",[ownerId]);
  const stored=(await tx.query('select profile from app.cabinet_profiles where user_id=$1',[ownerId])).rows[0];
  const profile=stored?load('postgres-profile').parseProductionProfile(stored.profile):null;
  const result={version:1,snapshot:account.snapshot,account:{id:account.id,email:account.email,isBlocked:account.isBlocked,
   emailVerifiedAt:account.email_verified_at,createdAt:account.created_at},profile};
  const optional=(await tx.query(`select to_regclass('app.payment_refund_reservations') is not null as refunds,
    to_regclass('app.payment_checkout_cancellations') is not null as checkout_cancellations,
    to_regclass('app.payment_renewals') is not null as renewals,
    to_regclass('app.media_retirement_requests') is not null as media_retirement,
    to_regclass('app.application_contact_views') is not null as contact_views,
    to_regclass('app.application_selection_events') is not null as selections,
    exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='app_stats' and c.relname='listing_views' and c.relkind='r') as listing_views`)).rows[0];
  if(emailSha256&&!optional.listing_views)throw Error('Listing view schema unavailable for approved export');
  if(optional.listing_views)result.listingViews=await readAccountListingViews(tx,ownerId,listingViewRateSecret,
   emailSha256?'approved-export':'direct');
  const queries={...records,payments:`select i.id,i.target_type,i.target_id,i.tariff_id,i.amount::text,i.duration_days,i.is_test,i.created_at,o.status,
    v.status as verification_status,v.captured_at,f.fulfilled_at,${optional.checkout_cancellations?'c.cancelled_at':'null::timestamptz'} as cancelled_at
    from app.payment_checkout_intents i left join app.payment_orders o on o.id=i.id and o.owner_id=i.owner_id
    left join app.payment_verifications v on v.intent_id=o.id left join app.payment_fulfillments f on f.intent_id=v.intent_id
    ${optional.checkout_cancellations?'left join app.payment_checkout_cancellations c on c.payment_id=o.id and c.owner_id=i.owner_id and c.target_type=i.target_type':''}
    where i.owner_id=$1 order by i.created_at,i.id`};
  if(optional.contact_views)queries.applicationContactViews=`select v.application_id,v.evidence,v.recorded_at
    from app.application_contact_views v join app.applications a on a.id=v.application_id
    where v.recipient_id=$1 or a.applicant_id=$1 order by v.recorded_at,v.application_id,v.evidence`;
  if(optional.selections)queries.applicationSelections=`select e.application_id,e.selected_at
    from app.application_selection_events e join app.applications a on a.id=e.application_id
    where e.recipient_id=$1 or a.applicant_id=$1 order by e.selected_at,e.application_id`;
  if(optional.refunds)queries.refunds=`select r.id,r.payment_intent_id,r.amount::text,r.created_at,
    (select o.status from app.payment_refund_observations o where o.operation_id=r.id order by o.observed_at desc,o.status limit 1) as status
    from app.payment_refund_reservations r join app.payment_checkout_intents i on i.id=r.payment_intent_id
    where i.owner_id=$1 order by r.created_at,r.id`;
  if(optional.renewals)queries.paymentRenewals=`select r.intent_id,r.previous_intent_id,r.additional_starts_at,r.additional_expires_at,r.recorded_at
    from app.payment_checkout_intents i join app.payment_renewals r on r.intent_id=i.id
    join app.payment_checkout_intents previous on previous.id=r.previous_intent_id and previous.owner_id=i.owner_id
    where i.owner_id=$1 order by i.created_at,i.id`;
  if(optional.media_retirement)queries.mediaRetirement=`select r.media_id,r.requested_at,c.completed_at
    from app.media_retirement_requests r join app.media_objects m on m.id=r.media_id
    left join app.media_retirement_completions c on c.media_id=r.media_id
    where m.owner_id=$1 order by r.requested_at,r.media_id`;
  for(const [name,sql] of Object.entries(queries)){
   await tx.query(`declare account_export_rows no scroll cursor for ${sql}`,[ownerId]);
   const sectionRows=[];
   for(;;){
    const {rows}=await tx.query(`fetch forward ${exportBatchSize} from account_export_rows`);
    sectionRows.push(...rows);
    if(rows.length<exportBatchSize)break;
   }
   await tx.query('close account_export_rows');
   result[name]=sectionRows;
  }
  for(const row of result.applications){
   if(row.profile)row.profile=Object.fromEntries(applicationProfileKeys.filter(key=>Object.hasOwn(row.profile,key)).map(key=>[key,row.profile[key]]));
  }
  for(const row of result.work)row.form=load('work-publication-contract').parseWorkPublicationForm(row.kind,row.form);
  for(const row of result.services)row.form=load('service-publication-contract').parseServicePublicationForm(row.kind,row.form);
  return result;
 },options);
 // The earlier snapshot cannot see a session revoked during the export.
 await db.readTransaction(async tx=>{
  const current=(await tx.query('select u.email '+access,credentials)).rows[0];
  if(!current||current.email!==data.account.email)throw new DeletionAccessError();
 },options);
 return data;
}

export async function prepareApprovedProductionAccountExport(db,token,approval,{outputRoot,mediaRoot,listingViewRateSecret,disclosure}){
 const root=await privateDirectory(outputRoot);
 try{
  const {caseId,data}=await readApprovedProductionAccountExport(db,token,approval,{listingViewRateSecret});
  const directory=await mkdtemp(join('/proc/self/fd/'+root.fd,'account-export-reviewed-'));
  try{
   const verifiedFiles=await writeAccountSnapshotFiles(data,directory,mediaRoot,localArchiveMaximumBytes);
   await writeAccountReport(directory,data,caseId,disclosure);
   const opened=await root.stat({bigint:true}),current=await lstat(outputRoot,{bigint:true});
   assert.ok(opened.dev===current.dev&&opened.ino===current.ino);
   return{caseId,directory:join(outputRoot,basename(directory)),verifiedFiles};
  }catch(error){
   await rm(directory,{recursive:true,force:true});
   throw error;
  }
 }finally{await root.close();}
}

export async function writeAccountExportFiles(data,directory,mediaRoot,maximumBytes=Infinity){
 assert.equal(process.env.NODE_ENV,'test');
 return writeAccountSnapshotFiles(data,directory,mediaRoot,maximumBytes);
}

async function writeAccountSnapshotFiles(data,directory,mediaRoot,maximumBytes){
 const retired=new Set(data.mediaRetirement?.map(row=>row.media_id));
 const ready=data.media.filter(row=>row.state==='ready'&&!retired.has(row.id));
 if(maximumBytes!==Infinity&&Buffer.byteLength(JSON.stringify(data,null,2))+ready.reduce((total,row)=>total+row.size,0)>maximumBytes)
  throw Error('Export needs an offline handoff');
 await mkdir(join(directory,'media'),{mode:0o700});
 if(ready.length){
  const files=await load('media-files').createLocalMediaFileStore(mediaRoot);
  for(const row of ready){
   const bytes=await files.read(row);
   row.file='media/'+row.id+'.webp';
   await writeFile(join(directory,row.file),bytes,{flag:'wx',mode:0o600});
  }
 }
 await writeFile(join(directory,'account.json'),JSON.stringify(data,null,2)+'\n',{flag:'wx',mode:0o600});
 return ready.length;
}

async function withLocalExportDatabase(work){
 assert.equal(process.env.NODE_ENV,'test');
 const info=await lstat(stateDirectory);
 assert.ok(info.isDirectory()&&info.uid===process.getuid()&&(info.mode&0o777)===0o700&&await realpath(stateDirectory)===stateDirectory);
 const state=readLocalPrimaryState(stateFile,process.cwd());
 validateLocalPrimaryContainer(JSON.parse(await docker(['inspect',state.containerId]))[0],state);
 const {PostgresDatabase}=load('postgres');
 const ca=await readFile(join(stateDirectory,'refund-db-ca.pem'));
 const db=new PostgresDatabase(new pg.Pool({...localPrimaryDatabaseConfig(state,'owner'),ssl:{ca,rejectUnauthorized:true},max:1}));
 try{return await work(db,state);}
 finally{await db.close();}
}

async function writeLocalExport(ownerId,token,notice){
 const {data,state}=await withLocalExportDatabase(async(db,state)=>({
  data:await readAccountExport(db,token,ownerId,undefined,{listingViewRateSecret:state.rateSecret}),state,
 }));
 const directory=await mkdtemp(join(stateDirectory,'account-export-'));
 try{
  const verifiedFiles=await writeAccountExportFiles(data,directory,join(stateDirectory,'media'),notice?localArchiveMaximumBytes:Infinity);
  if(notice){
   const delivery=archiveRoot(stateDirectory,state.containerId);
   await mkdir(delivery,{recursive:true,mode:0o700});
   const receipt=await publishLocalAccountArchive(directory,delivery,ownerId,notice);
   await rm(directory,{recursive:true});
   return {...receipt,verifiedFiles};
  }
  return {directory,verifiedFiles};
 }catch(error){
  await rm(directory,{recursive:true,force:true});
  throw error;
 }
}

async function runOperatorExport([operatorFlag,operator,ownerFlag,owner,action,value,caseId],token){
 assert.equal(operatorFlag,'--operator');assert.equal(ownerFlag,'--owner');
 const operatorId=deletionId(operator),ownerId=deletionId(owner);
 if(action==='--prepare'){
  const notice=await readExportNotice(value);
  const data=await withLocalExportDatabase((db,state)=>readAccountExport(db,token,ownerId,operatorId,{listingViewRateSecret:state.rateSecret}));
  assert.ok(data.account.email.endsWith('.invalid'));
  const directory=await mkdtemp(join(stateDirectory,'account-export-reviewed-'));
  try{
   const verifiedFiles=await writeAccountExportFiles(data,directory,join(stateDirectory,'media'),localArchiveMaximumBytes);
   await writeLocalAccountReport(directory,data,caseId,notice);
   return {directory,report:'report.pdf',verifiedFiles};
  }catch(error){await rm(directory,{recursive:true,force:true});throw error;}
 }
 assert.ok(['--cabinet','--email','--revoke'].includes(action)&&caseId===undefined);
 const hash=hashSessionToken(token);
 if(!hash)throw new DeletionAccessError();
 const {email,state}=await withLocalExportDatabase(async(db,state)=>{
  const account=await db.readTransaction(async tx=>(await tx.query('select u.email '+verifiedOperator,
   [hash,ownerId,operatorId])).rows[0],{timeoutMs:5000});
  if(!account?.email.endsWith('.invalid'))throw new DeletionAccessError();
  return {email:account.email,state};
 });
 const delivery=archiveRoot(stateDirectory,state.containerId);
 if(action==='--revoke')return {revoked:await revokeLocalAccountArchive(delivery,ownerId,value)};
 const notice=await readReviewedAccountReport(value,stateDirectory,ownerId,email);
 if(action==='--email')return prepareLocalAccountEmail(value,stateDirectory,email);
 await mkdir(delivery,{recursive:true,mode:0o700});
 return publishLocalAccountArchive(value,delivery,ownerId,notice,true);
}

async function readExportNotice(path){
 const bytes=await readBoundedExportFile(path,32768);
 assert.ok(bytes);
 const notice=JSON.parse(bytes.toString('utf8'));
 assert.ok(notice&&typeof notice==='object');
 return notice;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{
  let token='';
  process.stdin.setEncoding('utf8');
  for await(const chunk of process.stdin){token+=chunk;if(token.length>65)throw new DeletionAccessError();}
  if(process.argv[2]==='--operator'){
   assert.ok(process.argv.length===8||process.argv.length===9);
   console.log(JSON.stringify(await runOperatorExport(process.argv.slice(2),token.trimEnd())));
  }else{
  assert.ok(process.argv.length===4||process.argv.length===6&&process.argv[4]==='--delivery-notice');
  assert.equal(process.argv[2],'--owner');
  const notice=process.argv[5]?await readExportNotice(process.argv[5]):undefined;
  console.log(JSON.stringify(await writeLocalExport(deletionId(process.argv[3]),token.trimEnd(),notice)));
  }
 }catch{console.error('Local account export failed');process.exitCode=1;}
}
