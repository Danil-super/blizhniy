// Candidate confined to a disposable test database; no CLI, route or installed capability.
import assert from 'node:assert/strict';import{createRequire}from'node:module';import{readFile}from'node:fs/promises';import{createHash}from'node:crypto';import{execFile}from'node:child_process';import{promisify}from'node:util';import pg from'pg';
import{tmpdir}from'node:os';import{join}from'node:path';
import{getUserAccessRolePlan}from'./user-access-role.mjs';import{readRefundSchema}from'./refund-worker-schema.mjs';import{localPrimaryImage}from'./local-primary-config.mjs';
const load=createRequire(import.meta.url)('./local-primary-modules.cjs').loadLocalPrimaryModule;
const{deletionId,deletionRevision,deletionObject,DeletionConflictError,DeletionAccessError}=load('account-deletion-contract');
const{withAppSessionTransaction}=load('app-session-transaction');
export class BasicErasureReviewRequired extends Error{constructor(){super('Account requires a separate erasure plan');this.name='BasicErasureReviewRequired';}}
export function parseBasicErasure(input){
 const row=deletionObject(input,['requestId','expectedRevision','expectedOwnerId','expectedAuthVersion','operationId']);
 return{requestId:deletionId(row.requestId),expectedRevision:deletionRevision(row.expectedRevision),expectedOwnerId:deletionId(row.expectedOwnerId),
  expectedAuthVersion:row.expectedAuthVersion==='0'?'0':deletionRevision(row.expectedAuthVersion),operationId:deletionId(row.operationId)};
}
const erasable=new Set(['app.users.id','app.cabinet_profiles.user_id','app.sessions.user_id','app.email_confirmations.user_id','app.password_recoveries.user_id',
 'app.registration_legal.user_id','app.telegram_phone_attempts.user_id','app.telegram_phone_bindings.user_id','app.mail_outbox.user_id','app.notifications.user_id',
 'app.account_deletion_requests.user_id','app.applications.applicant_id']);
const draftTables=new Set(['listings','work_publications','service_publications']);
const draftPhotoLinks=[['listings','listing_photos','listing_id'],['work_publications','work_publication_photos','publication_id'],
 ['service_publications','service_publication_photos','publication_id']];
const mediaMigration='0068-erasure-retired-media.sql';
function receipt(row,input){return{requestId:input.requestId,operationId:input.operationId,subjectId:input.expectedOwnerId,
 requestRevision:row.revision,completedAt:row.completedAt,primaryAccountErased:true,completeErasure:false,retained:['pseudonymous-case-audit','erasure-receipt','external-copies-unverified']};}

export async function readBasicErasureSchema(tx){
 const app=await readRefundSchema(tx),admin=await readRefundSchema(tx,{namespace:'app_admin'});
 const local=(await tx.query(`with objects as (
  select 'relation' kind,c.relname name,jsonb_build_array(c.relkind,c.relpersistence,c.relrowsecurity,c.relforcerowsecurity,c.reloptions,c.relowner=n.nspowner) definition
   from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='local_primary'
  union all select 'column',c.relname||'.'||a.attname,jsonb_build_array(a.attnum,format_type(a.atttypid,a.atttypmod),a.attnotnull,a.attidentity,a.attgenerated,pg_get_expr(d.adbin,d.adrelid,false))
   from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace left join pg_attrdef d on d.adrelid=c.oid and d.adnum=a.attnum where n.nspname='local_primary' and a.attnum>0 and not a.attisdropped
  union all select 'constraint',c.conname,jsonb_build_array(pg_get_constraintdef(c.oid,false),c.convalidated,c.conenforced) from pg_constraint c join pg_namespace n on n.oid=c.connamespace where n.nspname='local_primary'
  union all select 'index',c.relname,jsonb_build_array(pg_get_indexdef(i.indexrelid,0,false),i.indisvalid,i.indisready,i.indislive) from pg_index i join pg_class c on c.oid=i.indexrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='local_primary'
  union all select 'trigger',c.relname||'.'||case when t.tgisinternal then k.conname||'.'||t.tgfoid::regprocedure::text else t.tgname end,jsonb_build_array(case when not t.tgisinternal then pg_get_triggerdef(t.oid,false) end,t.tgenabled,t.tgtype,t.tgdeferrable,t.tginitdeferred)
   from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace left join pg_constraint k on k.oid=t.tgconstraint where n.nspname='local_primary'
  union all select 'function',p.oid::regprocedure::text,jsonb_build_array(pg_get_functiondef(p.oid)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='local_primary'
  union all select 'type',t.typname,jsonb_build_array(t.typtype,t.typcategory,t.typnotnull,t.typdefault) from pg_type t join pg_namespace n on n.oid=t.typnamespace where n.nspname='local_primary'
  union all select 'rule',c.relname||'.'||r.rulename,jsonb_build_array(pg_get_ruledef(r.oid,false),r.ev_enabled) from pg_rewrite r join pg_class c on c.oid=r.ev_class join pg_namespace n on n.oid=c.relnamespace where n.nspname='local_primary'
 ) select kind,name,definition from objects order by kind collate "C",name collate "C",definition::text collate "C" limit 1001`)).rows;
 assert.ok(local.length>0&&local.length<1001);return{app,admin,local:{count:local.length,sha256:createHash('sha256').update(JSON.stringify(local)).digest('hex')}};
}

export async function assertBasicErasureProfile(tx,database,mediaErasure){
 const plan=getUserAccessRolePlan(database,{tariffs:true});
 assert.deepEqual((await tx.query('select name,sha256 from blizhniy_meta.migrations order by name')).rows,plan.appJournal);
 const migration=await readFile(new URL('../database/candidates/0063-basic-account-erasure.sql',import.meta.url));
 const expected=JSON.parse(await readFile(new URL('../database/basic-account-erasure-schema63.json',import.meta.url),'utf8'));
 assert.equal(createHash('sha256').update(migration).digest('hex'),expected.migrationSha256);
 const journal=(await tx.query('select name,sha256 from app_admin.migrations order by name')).rows;
 const expectedJournal=[...plan.journal,{name:'0063-basic-account-erasure.sql',sha256:expected.migrationSha256}];
 let schema=expected.schema;
 if(mediaErasure){
  const addon=JSON.parse(await readFile(new URL('../database/basic-account-erasure-schema68.json',import.meta.url),'utf8'));
  const bytes=await readFile(new URL('../database/candidates/'+mediaMigration,import.meta.url));
  assert.equal(createHash('sha256').update(bytes).digest('hex'),addon.migrationSha256);
  expectedJournal.push({name:mediaMigration,sha256:addon.migrationSha256});schema=addon.schema;
 }
 assert.deepEqual(journal,expectedJournal);
 assert.deepEqual(await readBasicErasureSchema(tx),schema);
}

export async function verifiedRetiredMedia(tx,containerId,{subjectId,operationId,mediaIds}){
 const filter=mediaIds?'m.id=any($1::uuid[])':operationId
  ?'m.id in (select media_id from app_admin.account_erasure_media where operation_id=$1)'
  :'m.owner_id=$1';
 const maximum=mediaIds?.length??100;
 const {rows}=await tx.query(`select m.id,m.owner_id,m.mime_type as "mimeType",m.width,m.height,m.size,m.sha256,
  c.media_id is not null as completed,w.id as "attemptId"
  from app.media_objects m left join app.media_retirement_completions c on c.media_id=m.id
  left join app.media_write_attempts w on w.media_id=m.id
  where ${filter} order by m.id limit $2`,[mediaIds??operationId??subjectId,maximum+1]);
 if(rows.length>maximum||mediaIds&&rows.length!==maximum||
  rows.some(row=>row.completed!==true||!row.attemptId||row.owner_id!==(subjectId??null)))throw new BasicErasureReviewRequired();
 if(!rows.length)return [];
 try{
  const root=join(tmpdir(),'blizhniy-erasure-media-'+containerId);
  const files=await load('media-files').createLocalMediaFileStore(root);
  for(const row of rows){
   const state=await files.inspect(row,row.attemptId);
   if(state.final!=='absent'||state.temporary!=='absent'||state.linked)throw new BasicErasureReviewRequired();
  }
 }catch{throw new BasicErasureReviewRequired();}
 return rows.map(row=>row.id);
}

export async function eraseBasicAccount(db,token,expectedAdminId,value,containerId){
 return eraseAccount(db,token,expectedAdminId,value,containerId,false);
}

export async function eraseAccountWithRetiredMedia(db,token,expectedAdminId,value,containerId,expectedMediaIds){
 return eraseAccount(db,token,expectedAdminId,value,containerId,true,expectedMediaIds);
}

export async function detachRestoredDraftPhotos(db,token,expectedAdminId,value,containerId,expectedMediaIds){
 assert.ok(Array.isArray(expectedMediaIds)&&expectedMediaIds.length>0&&expectedMediaIds.length<=100);
 return eraseAccount(db,token,expectedAdminId,value,containerId,true,expectedMediaIds,true);
}

export async function inspectBasicErasureFixture(containerId){
 assert.equal(process.env.NODE_ENV,'test');
 assert.match(containerId,/^[a-f0-9]{64}$/);
 const meta=JSON.parse((await promisify(execFile)('docker',['--host','unix:///var/run/docker.sock','inspect',containerId],{timeout:5000,maxBuffer:1048576,env:{PATH:process.env.PATH,LANG:'C.UTF-8'}})).stdout)[0];
 const fixture=meta.Config?.Labels?.['blizhniy.erasure-test'];assert.match(fixture,/^blizhniy-erasure-[a-f0-9]{12}$/);
 assert.equal(meta.Id,containerId);assert.equal(meta.Name,'/'+fixture);assert.equal(meta.Config.Image,localPrimaryImage);assert.equal(meta.State.Running,true);
 assert.deepEqual(meta.Config.Cmd,['postgres','-c','blizhniy.erasure_fixture='+fixture]);
 assert.deepEqual(meta.HostConfig.Tmpfs,{'/var/lib/postgresql':'rw,size=268435456'});assert.equal(meta.HostConfig.Binds,null);
 assert.equal(meta.Mounts.length,0);
 const bindings=meta.NetworkSettings.Ports;assert.deepEqual(Object.keys(bindings),['5432/tcp']);assert.equal(bindings['5432/tcp'].length,1);assert.equal(bindings['5432/tcp'][0].HostIp,'127.0.0.1');
 const address=meta.NetworkSettings.Networks.bridge.IPAddress;assert.ok(address);
 return{fixture,address,port:5432};
}

async function eraseAccount(db,token,expectedAdminId,value,containerId,mediaErasure,expectedMediaIds,preparePhotos=false){
 const input=parseBasicErasure(value),adminId=deletionId(expectedAdminId);assert.equal(process.env.NODE_ENV,'test');
 if(adminId===input.expectedOwnerId)throw new DeletionAccessError();
 const fixture=await inspectBasicErasureFixture(containerId);
 const reference=`B1_${input.operationId.replaceAll('-','')}_${input.expectedAuthVersion}_${input.expectedRevision}`;
 return db.transaction(async tx=>{
  await tx.query("select set_config('lock_timeout','2s',true),set_config('statement_timeout','3s',true),set_config('transaction_timeout','10s',true)");
  const context=(await tx.query("select current_database() as database,current_user as role,session_user as login,current_setting('session_replication_role') as replication,current_setting('transaction_read_only') as readonly,current_setting('transaction_isolation') as isolation,current_setting('blizhniy.erasure_fixture',true) as fixture,host(inet_server_addr()) as address,inet_server_port() as port")).rows[0];
  assert.deepEqual(context,{database:'blizhniy_erasure_test',role:'postgres',login:'postgres',replication:'origin',readonly:'off',isolation:'read committed',...fixture});
  const tables=(await tx.query("select n.nspname as schema,c.relname as name from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('app','app_admin','local_primary') and c.relkind='r' and c.relname not in ('sessions','cabinet_profiles','email_confirmations','password_recoveries','registration_legal','telegram_phone_attempts','telegram_phone_bindings','mail_outbox','notifications') order by 1,2")).rows;
  // Confined/offline candidate: fence non-FK writers as well as normal user-locked callers.
  await tx.query('lock table '+tables.map(row=>pg.escapeIdentifier(row.schema)+'.'+pg.escapeIdentifier(row.name)).join(',')+' in share row exclusive mode');
  await assertBasicErasureProfile(tx,context.database,mediaErasure);
  return withAppSessionTransaction({transaction:work=>work(tx)},token,async(_tx,admin)=>{
   if(admin.id!==adminId)throw new DeletionAccessError();
   // User -> request lock order also fences ordinary create/edit/checkout transactions.
   const saved=(await tx.query('select operation_id,request_id,subject_id,actor_id,expected_auth_version::text,expected_request_revision::text from app_admin.basic_account_erasures where operation_id=$1 or request_id=$2',[input.operationId,input.requestId])).rows;
   if(saved.length&&(saved.length!==1||saved[0].operation_id!==input.operationId||saved[0].request_id!==input.requestId||saved[0].subject_id!==input.expectedOwnerId||saved[0].actor_id!==adminId||saved[0].expected_auth_version!==input.expectedAuthVersion||saved[0].expected_request_revision!==input.expectedRevision))throw new DeletionConflictError();
   const subject=(await tx.query("select id,role,auth_version::text as version,email=id::text||'@synthetic.invalid' as synthetic from app.users where id=$1 for update",[input.expectedOwnerId])).rows[0];
   let row=(await tx.query(`select id,user_id,status,revision::text,resolution,case_reference,
    to_char(resolved_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "completedAt"
    from app.account_deletion_requests where id=$1 for update`,[input.requestId])).rows[0];
   if(!row)throw new DeletionConflictError();
   const original=(await tx.query("select actor_id from app.account_deletion_events where request_id=$1 and status='requested' order by created_at,id",[input.requestId])).rows;
   if(original.length!==1||original[0].actor_id!==input.expectedOwnerId)throw new DeletionConflictError();
   if(saved.length&&!subject&&row.user_id===null&&row.status==='resolved'&&row.resolution==='partly_retained'&&row.case_reference===reference){
    if(mediaErasure){
     const linked=await verifiedRetiredMedia(tx,containerId,{operationId:input.operationId});
     if(expectedMediaIds!==undefined)assert.deepEqual(linked,expectedMediaIds);
    }
    if(preparePhotos)return{operationId:input.operationId,detachedLinks:0};
    return receipt(row,input);
   }
   if(saved.length)throw new DeletionConflictError();
   if(!subject||row.user_id!==subject.id||row.revision!==input.expectedRevision||!['requested','in_review'].includes(row.status)||subject.version!==input.expectedAuthVersion)throw new DeletionConflictError();
   if(subject.role!=='user'||subject.synthetic!==true)throw new BasicErasureReviewRequired();
   // Lock every owned mail row before checking state so a queued dispatch cannot cross erasure.
   const mail=(await tx.query('select state from app.mail_outbox where user_id=$1 order by id for update',[subject.id])).rows;
   if(mail.some(row=>['reserved','sending','unknown'].includes(row.state)))throw new BasicErasureReviewRequired();
   const drafts=(await tx.query(`select id,status='draft' and not is_paid and published_at is null and expires_at is null and fresh as eligible
    from (
     select id,status,is_paid,published_at,expires_at,view_count=0 as fresh from app.listings where author_id=$1
     union all select id,status,is_paid,published_at,expires_at,deleted_at is null from app.work_publications where author_id=$1
     union all select id,status,is_paid,published_at,expires_at,deleted_at is null from app.service_publications where author_id=$1
    ) owned limit 101`,[subject.id])).rows;
   const draftIds=drafts.map(draft=>draft.id);
   const outgoing=(await tx.query(`select id,status='pending_payment' and not is_paid and sent_at is null as eligible
    from app.applications where applicant_id=$1 limit 101`,[subject.id])).rows;
   const related=[...drafts,...outgoing],relatedIds=related.map(row=>row.id);
   if(related.length>100||related.some(row=>row.eligible!==true||row.id===subject.id)||new Set(relatedIds).size!==related.length)
    throw new BasicErasureReviewRequired();
   let mediaIds=[],detachedLinks=0;
   if(preparePhotos){
    const owned=await tx.query('select id from app.media_objects where owner_id=$1 order by id limit 101 for no key update',[subject.id]);
    mediaIds=owned.rows.map(media=>media.id);
    assert.deepEqual(mediaIds,expectedMediaIds);
    if(draftIds.length)for(const [draft,table,parent] of draftPhotoLinks){
     const result=await tx.query(`delete from app.${table} p using app.${draft} d
      where p.${parent}=d.id and d.author_id=$1 and d.id=any($2::uuid[]) and p.media_id=any($3::uuid[])`,[subject.id,draftIds,mediaIds]);
     detachedLinks+=result.rowCount;
    }
    const active=(await tx.query(`select exists(select 1 from app.media_reference_events
     where media_id=any($1::uuid[]) and event_type in ('history','observed_history')) or exists(
      select 1 from (select distinct on (media_id,source,resource_id) event_type from app.media_reference_events
       where media_id=any($1::uuid[]) and event_type in ('attached','detached','observed_attached')
       order by media_id,source,resource_id,event_id desc) latest where event_type<>'detached') as blocked`,[mediaIds])).rows[0];
    if(active?.blocked!==false)throw new BasicErasureReviewRequired();
   }else if(mediaErasure){
    mediaIds=await verifiedRetiredMedia(tx,containerId,{subjectId:subject.id});
    if(expectedMediaIds!==undefined)assert.deepEqual(mediaIds,expectedMediaIds);
   }
   const historicalDraftPhotos=draftIds.length>0&&mediaIds.length>0;
   const columns=(await tx.query(`select n.nspname as schema,c.relname as relation,a.attname as column
    from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace
    where n.nspname in ('app','app_admin','local_primary') and c.relkind in ('r','p') and a.attnum>0 and not a.attisdropped and a.atttypid='uuid'::regtype
    order by 1,2,3`)).rows;
   assert.ok(columns.length>=150);
   const predicates=columns.flatMap(row=>{
    const table=pg.escapeIdentifier(row.schema)+'.'+pg.escapeIdentifier(row.relation),column=pg.escapeIdentifier(row.column);
    const draftTable=row.schema==='app'&&draftTables.has(row.relation);
    const field=`${row.schema}.${row.relation}.${row.column}`;
    const ownRequestAudit=row.schema==='app'&&row.relation==='account_deletion_events'&&row.column==='actor_id'
     ?" and not(t.status='requested' and t.request_id in(select id from app.account_deletion_requests where user_id=$1))":'';
    const ownWithdrawal=(field==='app.application_withdrawals.owner_id'||field==='app.application_withdrawals.application_id')
     ?' and not(t.owner_id=$1 and exists(select 1 from app.applications a where a.id=t.application_id and a.applicant_id=$1))':'';
    const conditions=[];
    if(!erasable.has(field)&&!(draftTable&&row.column==='author_id')&&!(mediaErasure&&field==='app.media_objects.owner_id'))
     conditions.push(`(t.${column}=$1${ownRequestAudit}${ownWithdrawal})`);
    if(relatedIds.length){
     const ownDraft=draftTable&&row.column==='id'?' and t.author_id<>$1':'';
     const ownOutgoing=(field==='app.applications.id'||field==='app.applications.specialist_publication_id')?' and t.applicant_id<>$1':'';
     const retiredDraftObservation=historicalDraftPhotos&&field==='app.media_reference_events.resource_id'?
      ` and not(t.media_id=any($3::uuid[]) and t.resource_id=any($4::uuid[])
       and t.source in ('listing_photos','work_publication_photos','service_publication_photos','listings','work_publications','service_publications')
       and t.event_type in ('attached','detached','observed_attached'))`:'';
     conditions.push(`(t.${column}=any($2::uuid[])${ownDraft}${ownOutgoing}${ownWithdrawal}${retiredDraftObservation})`);
    }
    return conditions.length?[`exists(select 1 from ${table} t where ${conditions.join(' or ')})`]:[];
   });
   // Linked records need review even where the database has no foreign key.
   const identifiers=relatedIds.length?[subject.id,relatedIds]:[subject.id];
   if(historicalDraftPhotos)identifiers.push(mediaIds,draftIds);
   if((await tx.query(`select (${predicates.join(' or ')}) as blocked`,identifiers)).rows[0]?.blocked!==false)throw new BasicErasureReviewRequired();
   if(preparePhotos)return{operationId:input.operationId,detachedLinks};
   await tx.query("select set_config('blizhniy.deletion_actor',$1,true)",[admin.id]);
   if(row.status==='requested')await tx.query("update app.account_deletion_requests set status='in_review' where id=$1",[row.id]);
   await tx.query("update app.account_deletion_requests set status='resolved',resolution='partly_retained',case_reference=$2 where id=$1",[row.id,reference]);
   await tx.query('insert into app_admin.basic_account_erasures(operation_id,request_id,subject_id,actor_id,expected_auth_version,expected_request_revision) values($1,$2,$3,$4,$5,$6)',[input.operationId,row.id,subject.id,admin.id,input.expectedAuthVersion,input.expectedRevision]);
   if(mediaIds.length)await tx.query('insert into app_admin.account_erasure_media(operation_id,media_id) select $1,unnest($2::uuid[])',[input.operationId,mediaIds]);
   if((await tx.query("delete from app.users where id=$1 and role='user' and auth_version=$2 returning id",[subject.id,input.expectedAuthVersion])).rowCount!==1)throw new DeletionConflictError();
   if(mediaIds.length)assert.equal((await tx.query('select id from app.media_objects where id=any($1::uuid[]) and owner_id is null',[mediaIds])).rowCount,mediaIds.length);
   if(draftIds.length)assert.equal((await tx.query(`select 1 from app.listings where author_id=$1
     union all select 1 from app.work_publications where author_id=$1
     union all select 1 from app.service_publications where author_id=$1 limit 1`,[subject.id])).rowCount,0);
   if(outgoing.length)assert.equal((await tx.query('select 1 from app.applications where applicant_id=$1 limit 1',[subject.id])).rowCount,0);
   row=(await tx.query(`select user_id,status,revision::text,resolution,case_reference,
    to_char(resolved_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "completedAt" from app.account_deletion_requests where id=$1`,[row.id])).rows[0];
   assert.ok(row?.user_id===null&&row.status==='resolved'&&row.resolution==='partly_retained'&&row.case_reference===reference&&row.completedAt);
   return receipt(row,input);
  },{requireAdmin:true});
 });
}
