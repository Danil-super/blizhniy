// Offline synthetic restore candidate; signed evidence never authorizes reopening the site.
import assert from'node:assert/strict';import{createHash,createHmac,timingSafeEqual}from'node:crypto';import{readFile}from'node:fs/promises';import{createRequire}from'node:module';
import{eraseBasicAccount,parseBasicErasure,readBasicErasureSchema}from'./basic-account-erasure.mjs';
import{getUserAccessRolePlan}from'./user-access-role.mjs';
const load=createRequire(import.meta.url)('./local-primary-modules.cjs').loadLocalPrimaryModule;
const{deletionId,deletionObject}=load('account-deletion-contract'),{hashSessionToken}=load('identity'),scope='blizhniy-basic-erasure-test',maximumBytes=2097152;
const hex=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const digest=text=>createHash('sha256').update(text).digest('hex');
export class ErasureLedgerValidationError extends Error{constructor(){super('Invalid or untrusted erasure ledger');this.name='ErasureLedgerValidationError';this.reopenAuthorized=false;}}
function secret(key){assert.ok(Buffer.isBuffer(key)&&key.length===32);return key;}
function normalizedRecord(value){
 const row=deletionObject(value,['operationId','requestId','subjectId','actorId','authVersion','requestRevision','completedAt']);
 const input=parseBasicErasure({operationId:row.operationId,requestId:row.requestId,expectedOwnerId:row.subjectId,expectedAuthVersion:row.authVersion,expectedRevision:row.requestRevision});
 assert.ok(typeof row.completedAt==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(row.completedAt)&&new Date(row.completedAt).toISOString()===row.completedAt);
 return{operationId:input.operationId,requestId:input.requestId,subjectId:input.expectedOwnerId,actorId:deletionId(row.actorId),authVersion:input.expectedAuthVersion,requestRevision:input.expectedRevision,completedAt:row.completedAt};
}
function payload(records,sourceId){
 assert.ok(Array.isArray(records)&&records.length<=1000);const rows=Array.from(records,normalizedRecord);
 for(const name of ['operationId','requestId','subjectId'])assert.equal(new Set(rows.map(row=>row[name])).size,rows.length);
 rows.sort((a,b)=>a.operationId<b.operationId?-1:1);return{version:1,scope,sourceId:deletionId(sourceId),records:rows};
}
export function sealBasicErasureLedger(records,key,sourceId){
 const body=payload(records,sourceId),signature=createHmac('sha256',secret(key)).update(JSON.stringify(body)).digest('hex');
 const document=JSON.stringify({payload:body,signature});assert.ok(Buffer.byteLength(document)<=maximumBytes);return document;
}
export function verifyBasicErasureLedger(document,key,trustedCheckpoint){
 try{
 secret(key);const checkpoint=deletionObject(trustedCheckpoint,['sourceId','sha256']);deletionId(checkpoint.sourceId);assert.ok(hex(checkpoint.sha256));
 assert.ok(typeof document==='string'&&Buffer.byteLength(document)<=maximumBytes&&digest(document)===checkpoint.sha256);
 const envelope=deletionObject(JSON.parse(document),['payload','signature']),body=deletionObject(envelope.payload,['version','scope','sourceId','records']);
 assert.equal(body.version,1);assert.equal(body.scope,scope);assert.equal(body.sourceId,checkpoint.sourceId);assert.ok(hex(envelope.signature));
 const normalized=payload(body.records,body.sourceId);assert.equal(document,JSON.stringify({payload:normalized,signature:envelope.signature}));
 const expected=createHmac('sha256',key).update(JSON.stringify(normalized)).digest();assert.ok(timingSafeEqual(expected,Buffer.from(envelope.signature,'hex')));return normalized;
 }catch{throw new ErasureLedgerValidationError();}
}
export async function exportBasicErasureLedger(db,key,sourceId){
 assert.equal(process.env.NODE_ENV,'test');secret(key);deletionId(sourceId);
 return db.readTransaction(async tx=>{
  const context=(await tx.query("select current_database() as database,current_user as role,session_user as login,current_setting('session_replication_role') as replication,current_setting('transaction_read_only') as readonly,current_setting('transaction_isolation') as isolation")).rows[0];
  assert.deepEqual(context,{database:'blizhniy_erasure_test',role:'postgres',login:'postgres',replication:'origin',readonly:'on',isolation:'repeatable read'});
  const expected=JSON.parse(await readFile(new URL('../database/basic-account-erasure-schema63.json',import.meta.url),'utf8'));assert.deepEqual(await readBasicErasureSchema(tx),expected.schema);
  const plan=getUserAccessRolePlan(context.database,{tariffs:true});assert.deepEqual((await tx.query('select name,sha256 from blizhniy_meta.migrations order by name')).rows,plan.appJournal);
  assert.deepEqual((await tx.query('select name,sha256 from app_admin.migrations order by name')).rows,[...plan.journal,{name:'0063-basic-account-erasure.sql',sha256:expected.migrationSha256}]);
  const rows=(await tx.query(`select e.operation_id as "operationId",e.request_id as "requestId",e.subject_id as "subjectId",e.actor_id as "actorId",
   e.expected_auth_version::text as "authVersion",e.expected_request_revision::text as "requestRevision",
   to_char(e.completed_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as "completedAt",
   r.user_id,r.status,r.resolution,r.case_reference,exists(select 1 from app.users u where u.id=e.subject_id) as present,
   (select count(*)::text from app.account_deletion_events a where a.request_id=e.request_id and a.status='requested' and a.actor_id=e.subject_id) as original
   from app_admin.basic_account_erasures e left join app.account_deletion_requests r on r.id=e.request_id order by e.operation_id limit 1001`)).rows;
  assert.ok(rows.length<=1000);
  const records=rows.map(({user_id,status,resolution,case_reference,present,original,...record})=>{
   assert.ok(user_id===null&&status==='resolved'&&resolution==='partly_retained'&&present===false&&original==='1');
   assert.equal(case_reference,`B1_${record.operationId.replaceAll('-','')}_${record.authVersion}_${record.requestRevision}`);return record;
  });
  const document=sealBasicErasureLedger(records,key,sourceId);return{document,checkpoint:{sourceId,sha256:digest(document)}};
 },{timeoutMs:5000});
}
export class ErasureRestoreIncompleteError extends Error{
 constructor(confirmed){super('Erasure replay incomplete; restored site must stay closed');this.name='ErasureRestoreIncompleteError';this.confirmedOperations=confirmed;this.reopenAuthorized=false;}
}
export async function reapplyBasicErasureLedger(db,document,key,checkpoint,actorSessions,containerId){
 try{
 assert.equal(process.env.NODE_ENV,'test');const body=verifyBasicErasureLedger(document,key,checkpoint);assert.ok(actorSessions instanceof Map);
 const sessions=new Map();for(const row of body.records){const token=actorSessions.get(row.actorId);assert.ok(hex(token));sessions.set(row.actorId,token);}
 await db.readTransaction(async tx=>{
  const context=(await tx.query("select current_database() as database,current_setting('transaction_read_only') as readonly,current_setting('transaction_isolation') as isolation")).rows[0];
  assert.deepEqual(context,{database:'blizhniy_erasure_test',readonly:'on',isolation:'repeatable read'});
  for(const[actor,token]of sessions){
   const row=(await tx.query(`select exists(select 1 from app.sessions s join app.users u on u.id=s.user_id
    where s.token_hash=$1 and s.user_id=$2 and s.auth_version=u.auth_version and s.scope='app'
    and u.role='admin' and not u.is_blocked and u.email_verified_at is not null
    and s.expires_at>clock_timestamp() and s.last_seen_at>clock_timestamp()-interval '30 minutes') as allowed`,[hashSessionToken(token),actor])).rows[0];
   assert.equal(row?.allowed,true);
  }
 },{timeoutMs:5000});
 const receipts=[];
 for(const row of body.records){
  try{receipts.push(await eraseBasicAccount(db,sessions.get(row.actorId),row.actorId,{operationId:row.operationId,requestId:row.requestId,expectedOwnerId:row.subjectId,expectedAuthVersion:row.authVersion,expectedRevision:row.requestRevision},containerId));}
  catch{throw new ErasureRestoreIncompleteError(receipts.length);}
 }
 return{listedOperations:body.records.length,receipts,reopenAuthorized:false};
 }catch(error){if(error instanceof ErasureRestoreIncompleteError)throw error;throw new ErasureRestoreIncompleteError(0);}
}
