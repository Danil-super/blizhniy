// Operates only on the owned synthetic stand. The database snapshot never refreshes the session.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {lstat,mkdtemp,readFile,mkdir,realpath,rm,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import pg from 'pg';
import {docker,localPrimaryDatabaseConfig,stateDirectory,stateFile} from './local-primary-fixture.mjs';
import {readLocalPrimaryState,validateLocalPrimaryContainer} from './local-primary-config.mjs';
import {archiveRoot,localArchiveMaximumBytes,publishLocalAccountArchive} from './local-account-export-delivery.mjs';

const load=createRequire(import.meta.url)('./local-primary-modules.cjs').loadLocalPrimaryModule;
const {DeletionAccessError,deletionId}=load('account-deletion-contract');
const {hashSessionToken}=load('identity');
const exportBatchSize=500;
const records={
 consents:'select document,version,recorded_at from app.registration_legal where user_id=$1 order by document',
 sessions:'select scope,created_at,expires_at,last_seen_at from app.sessions where user_id=$1 order by created_at,scope',
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
 applications:`select a.id,a.work_publication_id,a.specialist_publication_id,case when a.applicant_id=$1 then 'applicant' else 'recipient' end as side,
  case when a.applicant_id=$1 then a.message end as message,case when a.applicant_id=$1 then a.snapshot end as profile,
  a.status,a.is_paid,a.sent_at,a.created_at,a.updated_at,a.revision::text
  from app.applications a join app.work_publications w on w.id=a.work_publication_id
  where a.applicant_id=$1 or (w.author_id=$1 and a.is_paid and a.sent_at is not null) order by a.created_at,a.id`,
 bookings:`select id,listing_id,case when guest_id=$1 then 'guest' else 'host' end as side,mode,start_date::text,end_date::text,
  guests,total::text,status,revision::text,created_at,updated_at,decided_at,starts_at,expires_at,
  case when cancelled_by=$1 then cancellation_reason end as cancellation_reason
  from app.booking_requests where guest_id=$1 or host_id=$1 order by created_at,id`,
 bookingEvents:`select e.booking_id,e.revision::text,e.status,e.actor_id=$1 as actor_is_owner,
  case when e.actor_id=$1 then e.reason end as reason,e.origin,e.created_at
  from app.booking_events e join app.booking_requests b on b.id=e.booking_id
  where b.guest_id=$1 or b.host_id=$1 order by e.booking_id,e.revision`,
 payments:`select i.id,i.target_type,i.target_id,i.tariff_id,i.amount::text,i.duration_days,i.is_test,i.created_at,o.status,
  v.status as verification_status,v.captured_at,f.fulfilled_at
  from app.payment_checkout_intents i left join app.payment_orders o on o.id=i.id and o.owner_id=i.owner_id
  left join app.payment_verifications v on v.intent_id=o.id left join app.payment_fulfillments f on f.intent_id=v.intent_id
  where i.owner_id=$1 order by i.created_at,i.id`,
 notifications:`select id,category,tone,title,body,action_href,read_at,created_at from app.notifications
  where user_id=$1 order by created_at,id`,
 deletionRequests:`select id,status,revision::text,requested_at,review_started_at,resolved_at,resolution
  from app.account_deletion_requests where user_id=$1 order by requested_at,id`,
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

export async function readAccountExport(db,token,confirmedOwnerId){
 assert.equal(process.env.NODE_ENV,'test');
 const ownerId=deletionId(confirmedOwnerId),hash=hashSessionToken(token);
 if(!hash)throw new DeletionAccessError();
 return db.readTransaction(async tx=>{
  const context=(await tx.query(`select current_user='postgres' and session_user='postgres'
    and current_database() in ('blizhniy_test','blizhniy_prod','blizhniy_erasure_test')
    and current_setting('transaction_read_only')='on' and current_setting('transaction_isolation')='repeatable read' as allowed`)).rows[0];
  assert.equal(context?.allowed,true);
  const account=(await tx.query(`select u.id,u.email,u.is_blocked as "isBlocked",u.email_verified_at,u.created_at,
    to_char(transaction_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as snapshot
    from app.users u join app.sessions s on s.user_id=u.id and s.auth_version=u.auth_version
    where s.token_hash=$1 and u.id=$2 and u.email_verified_at is not null and s.scope in ('app','data-subject')
      and s.expires_at>clock_timestamp() and s.last_seen_at>clock_timestamp()-interval '30 minutes'`,[hash,ownerId])).rows[0];
  if(!account)throw new DeletionAccessError();
  const stored=(await tx.query('select profile from app.cabinet_profiles where user_id=$1',[ownerId])).rows[0];
  const profile=stored?load('postgres-profile').parseProductionProfile(stored.profile):null;
  const result={version:1,snapshot:account.snapshot,account:{id:account.id,email:account.email,isBlocked:account.isBlocked,
   emailVerifiedAt:account.email_verified_at,createdAt:account.created_at},profile};
  const optional=(await tx.query(`select to_regclass('app.payment_refund_reservations') is not null as refunds,
    to_regclass('app.media_retirement_requests') is not null as media_retirement,
    to_regclass('app.application_contact_views') is not null as contact_views,
    to_regclass('app.application_selection_events') is not null as selections`)).rows[0];
  const queries={...records};
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
  if(!(await tx.query(`select 1 from app.sessions where token_hash=$1 and user_id=$2
    and expires_at>clock_timestamp() and last_seen_at>clock_timestamp()-interval '30 minutes'`,[hash,ownerId])).rowCount)throw new DeletionAccessError();
  return result;
 },{timeoutMs:5000});
}

export async function writeAccountExportFiles(data,directory,mediaRoot,maximumBytes=Infinity){
 assert.equal(process.env.NODE_ENV,'test');
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

async function writeLocalExport(ownerId,token,notice){
 assert.equal(process.env.NODE_ENV,'test');
 const info=await lstat(stateDirectory);
 assert.ok(info.isDirectory()&&info.uid===process.getuid()&&(info.mode&0o777)===0o700&&await realpath(stateDirectory)===stateDirectory);
 const state=readLocalPrimaryState(stateFile,process.cwd());
 validateLocalPrimaryContainer(JSON.parse(await docker(['inspect',state.containerId]))[0],state);
 const {PostgresDatabase}=load('postgres');
 const ca=await readFile(join(stateDirectory,'refund-db-ca.pem'));
 const db=new PostgresDatabase(new pg.Pool({...localPrimaryDatabaseConfig(state,'owner'),ssl:{ca,rejectUnauthorized:true},max:1}));
 let data;
 try{
  data=await readAccountExport(db,token,ownerId);
 }finally{await db.close();}
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

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{
  assert.ok(process.argv.length===4||process.argv.length===6&&process.argv[4]==='--delivery-notice');
  assert.equal(process.argv[2],'--owner');
  const noticePath=process.argv[5];let notice;
  if(noticePath){
   const info=await lstat(noticePath);assert.ok(info.isFile()&&info.size>0&&info.size<=32768);
   notice=JSON.parse(await readFile(noticePath,'utf8'));assert.ok(notice&&typeof notice==='object');
  }
  let token='';
  process.stdin.setEncoding('utf8');
  for await(const chunk of process.stdin){token+=chunk;if(token.length>65)throw new DeletionAccessError();}
  console.log(JSON.stringify(await writeLocalExport(deletionId(process.argv[3]),token.trimEnd(),notice)));
 }catch{console.error('Local account export failed');process.exitCode=1;}
}
