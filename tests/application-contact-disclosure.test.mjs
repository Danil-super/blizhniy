import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import test from 'node:test';

const load=createRequire(import.meta.url)('../scripts/local-primary-modules.cjs').loadLocalPrimaryModule;
const {PostgresApplicationStore,ApplicationAccessError}=load('postgres-applications');
const {createProductionApplicationHandler}=load('production-application-http');
const actor='11111111-1111-4111-8111-111111111111',applicant='22222222-2222-4222-8222-222222222222';
const id='33333333-3333-4333-8333-333333333333',target='44444444-4444-4444-8444-444444444444';
const token='a'.repeat(64),origin='https://disclosure.example.invalid';
async function local(work){
 const values={BLIZHNIY_LOCAL_PRIMARY:'enabled',BLIZHNIY_LOCAL_PRIMARY_ORIGIN:'https://127.0.0.1:3045',BLIZHNIY_LISTING_WORKFLOW:'postmoderation'};
 const previous=Object.fromEntries(Object.keys(values).map(key=>[key,process.env[key]]));Object.assign(process.env,values);
 try{return await work();}finally{for(const [key,value] of Object.entries(previous)){if(value===undefined)delete process.env[key];else process.env[key]=value;}}
}
function fixture(failure,asApplicant=false){
 const events=[],owner=asApplicant?applicant:actor;
 const row={id,applicant,targetOwner:actor,targetId:target,kind:'workRequest',targetTitle:'Синтетический заказ',creationKey:target,targetRevision:'1',specialistId:target,specialistRevision:'1',revision:'1',
  snapshot:{name:'Синтетический специалист',profession:'Сантехник',price:'3500.00',skills:'Ремонт',phone:'+79990000000',email:'private-contact@example.invalid',messengerUrl:null},
  message:'Синтетический отклик',status:'sent',paid:true,sentAt:'2026-11-01T00:00:00.000000Z',createdAt:'2026-10-31T00:00:00.000000Z',updatedAt:'2026-11-01T00:00:00.000000Z'};
 const result=rows=>({rows,rowCount:rows.length});
 const tx={query:async(sql)=>{
  if(sql.includes('from app.users u where'))return result([{id:owner,role:'user',isBlocked:false,verified:true,authVersion:'0'}]);
  if(sql.includes('from app.sessions where'))return result([{token_hash:'synthetic'}]);
  if(sql.startsWith('update app.sessions set'))return result([{}]);
  if(sql.includes('from app.applications a join app.work_publications w'))return result([row]);
  if(sql.startsWith('select id from app.work_publications'))return result([{id:target}]);
  if(sql.startsWith('insert into app.application_contact_views')){
   events.push('evidence');if(failure==='insert')throw new Error('private-sql-contact-failure');return result([{}]);
  }
  assert.fail('Unexpected query in disclosure boundary fixture');
 }};
 const db={transaction:async work=>{try{const value=await work(tx);events.push('commit');if(failure==='commit')throw new Error('private-commit-contact-failure');return value;}catch(error){events.push('rollback-or-unknown');throw error;}}};
 return {events,owner,store:new PostgresApplicationStore(db,{localActions:true,contactViews:true})};
}

test('contact evidence commits before authorized recipient contacts return; reading own response is not a view',()=>local(async()=>{
 const recipient=fixture();const detail=await recipient.store.read(token,recipient.owner,id);recipient.events.push('returned');
 assert.equal(detail.snapshot.email,'private-contact@example.invalid');assert.deepEqual(recipient.events,['evidence','commit','returned']);
 const own=fixture(undefined,true);await own.store.read(token,own.owner,id);assert.deepEqual(own.events,['commit']);
}));

for(const failure of ['insert','commit'])test(`contact ${failure} failure produces a private HTTP failure without a contact payload`,()=>local(async()=>{
 const f=fixture(failure),audit=[];
 const handle=createProductionApplicationHandler({origin},()=>({store:f.store,limiter:{allowProduction:async()=>true}}),event=>audit.push(event));
 const response=await handle(new Request(origin+'/api/account/applications',{method:'POST',headers:{host:new URL(origin).host,origin,'content-type':'application/json','x-blizhniy-request':'1','x-real-ip':'192.0.2.5',cookie:'__Host-blizhniy_session='+token},body:JSON.stringify({action:'read',expectedOwnerId:actor,applicationId:id})}));
 assert.equal(response.status,503);assert.deepEqual(await response.json(),{error:{code:'APPLICATIONS_UNAVAILABLE'}});
 assert.equal(JSON.stringify(audit).includes('private-'),false);assert.equal(JSON.stringify(audit).includes('7999'),false);
 assert.deepEqual(f.events,failure==='insert'?['evidence','rollback-or-unknown']:['evidence','commit','rollback-or-unknown']);
}));

test('contact-view policy refuses production or mismatched local configuration before querying storage',()=>local(async()=>{
 const db={transaction:()=>assert.fail('Configuration refusal must precede storage')};
 for(const value of [false,'https://example.invalid']){
  if(value===false)delete process.env.BLIZHNIY_LOCAL_PRIMARY;
  else{process.env.BLIZHNIY_LOCAL_PRIMARY='enabled';process.env.BLIZHNIY_LOCAL_PRIMARY_ORIGIN=value;}
  assert.throws(()=>new PostgresApplicationStore(db,{localActions:true,contactViews:true}),error=>error instanceof ApplicationAccessError||/^Invalid (primary workflow deployment|local primary origin)$/.test(error.message));
 }
}));

test('an invalid contact-view deployment flag cannot silently disable evidence',()=>{
 const {readApplicationContactViewsMode}=load('production-application-runtime');
 assert.equal(readApplicationContactViewsMode({}),false);
 assert.equal(readApplicationContactViewsMode({BLIZHNIY_APPLICATION_CONTACT_VIEWS:'enabled'}),true);
 assert.equal(readApplicationContactViewsMode({BLIZHNIY_APPLICATION_CONTACT_VIEWS:'disabled'}),false);
 for(const value of ['', 'true', 'enabled ', 'ENABLED'])assert.throws(()=>readApplicationContactViewsMode({BLIZHNIY_APPLICATION_CONTACT_VIEWS:value}),/Invalid application contact view policy/);
});

test('hosted contact evidence requires the authorized production workflow',()=>{
 const {readApplicationContactViewsMode}=load('production-application-runtime');
 const hosted={NODE_ENV:'production',BLIZHNIY_AUTH_MODE:'postgres',BLIZHNIY_AUTH_ORIGIN:'https://xn----9sbphbgks4a4a.xn--p1ai',
  BLIZHNIY_LISTING_WORKFLOW:'postmoderation',BLIZHNIY_APPLICATION_CONTACT_VIEWS:'production-v1'};
 assert.equal(readApplicationContactViewsMode(hosted),'production-v1');
 for(const mismatch of [{NODE_ENV:'test'},{BLIZHNIY_AUTH_MODE:'local'},{BLIZHNIY_AUTH_ORIGIN:'https://other.invalid'},
  {BLIZHNIY_LISTING_WORKFLOW:'pre-moderation'},{BLIZHNIY_LOCAL_PRIMARY:'enabled'},{BLIZHNIY_LOCAL_PRIMARY_ORIGIN:'https://127.0.0.1:3045'}])
  assert.throws(()=>readApplicationContactViewsMode({...hosted,...mismatch}),/Invalid production application contact view policy/);
});
