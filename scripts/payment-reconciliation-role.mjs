// Trusted operator/runtime library only. Importing does not connect, create roles or grant privileges.
import {getCabinetMigrationPlan} from './cabinet-release-plan.mjs';
import {getBootstrapPlan} from './postgres-migration-plan.mjs';
import {assertFinancialCatalogPrivileges} from './financial-catalog-privileges.mjs';
import {getSpecialistCheckoutMigration,hasSpecialistCheckoutObjects} from './specialist-checkout-release.mjs';
import {getRefundWorkerRolePlan} from './refund-worker-role.mjs';
import {assertRefundSchema} from './refund-worker-schema.mjs';
import {getPublicationTestMigrationPlan,assertPublicationTestSchema,assertExtendedPublicationTestSchema,hasInboxPreferenceObjects,getInboxPreferenceMigration,getSpecialistAccountTestMigration} from './publication-test-release-plan.mjs';

const role='blizhniy_payment_reconciler';
const locks=['users','payment_checkout_intents','categories','cities','media_objects','listing_moderation'];
const columns=text=>text.split(',');
const policy={
 'app.users':{select:columns('id,is_blocked,email_verified_at'),update:['id']},
 'app.payment_checkout_intents':{select:columns('id,owner_id,target_type,target_id,target_revision,tariff_id,amount,duration_days,merchant_shop_id,is_test,request_body,request_sha256'),update:['id']},
 'app.payment_provider_links':{select:columns('intent_id,provider_payment_id')},
 'app.payment_orders':{select:columns('id,status'),update:['status']},
 'app.payment_verifications':{select:columns('intent_id,provider_payment_id,status,captured_at'),insert:columns('intent_id,provider_payment_id,status,captured_at'),update:columns('status,captured_at')},
 'app.payment_fulfillments':{select:columns('intent_id,published_at,expires_at'),insert:columns('intent_id,published_at,expires_at')},
 'app.payment_reconciliation_jobs':{select:columns('intent_id,state,attempts,claim_id,lease_until,next_attempt_at,last_code'),update:columns('state,attempts,claim_id,lease_until,next_attempt_at,last_code')},
 'app.listings':{select:columns('id,author_id,listing_type,title,description,price,category_id,city_id,district,address,latitude,longitude,show_exact_address,contact_phone,messenger_url,booking,revision,status,is_paid,published_at,expires_at,created_at'),update:columns('status,is_paid,published_at,expires_at,updated_at')},
 'app.listing_photos':{select:columns('listing_id,media_id,position')},
 'app.media_objects':{select:columns('id,owner_id,state,mime_type,width,height,size'),update:['id']},
 'app.categories':{select:columns('id,parent_id,slug,name,active'),update:['id']},
 'app.cities':{select:columns('id,name'),update:['id']},
 'app.tariffs':{select:columns('id,action,name,price,duration_days,active')},
 'app.listing_moderation':{select:columns('id,listing_id,revision,state'),update:['id']},
 'blizhniy_meta.migrations':{select:['name','sha256']},
};
const cabinetPolicy={...policy,'app.listing_blocks':{select:['listing_id']}};
const publicationPolicy={...cabinetPolicy,
 'app.payment_reconciliation_jobs':{...policy['app.payment_reconciliation_jobs'],insert:['intent_id']},
 'app.work_publications':{select:columns('id,author_id,kind,form,city_id,profession_id,revision,status,is_paid,published_at,expires_at,created_at,updated_at,deleted_at'),update:columns('status,is_paid,published_at,expires_at,updated_at')},
 'app.work_publication_photos':{select:columns('publication_id,media_id,position')},
 'app.specialist_categories':{select:columns('id,name,active'),update:['id']},
 'app.applications':{select:columns('id,work_publication_id,status,is_paid,sent_at')},
};
const validDatabase=value=>typeof value==='string'&&/^[a-zA-Z0-9_.-]{1,63}$/.test(value);
function approved(){return getBootstrapPlan({includePaymentReconciliationRole:true});}

/** Reviewable plan only. No executor, ambient credentials, password or automatic role adoption. */
export function getPaymentReconciliationRolePlan(database,{cabinet=false,publicationTest=false}={}) {
 if(typeof cabinet!=='boolean'||typeof publicationTest!=='boolean'||publicationTest&&!cabinet||!validDatabase(database))throw new Error('Invalid reconciliation database');
 return{role,createRole:`create role ${role} nologin nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls connection limit 4`,
  journal:(publicationTest?getPublicationTestMigrationPlan():approved()).map(({name,sha256})=>({name,sha256})),
  grants:[`grant connect on database "${database}" to ${role}`,`grant usage on schema app,blizhniy_meta to ${role}`,
   ...Object.entries(publicationTest?publicationPolicy:cabinet?cabinetPolicy:policy).flatMap(([table,access])=>Object.entries(access).map(([privilege,names])=>`grant ${privilege}(${names.join(',')}) on ${table} to ${role}`))],
 };
}

/** Read-only startup check for this dedicated financial role, never an owner-role fallback.
 * Requires the journal, exact column ACLs, no worker memberships/grant options, and active lock guards.
 * Approved managed-PG exception: bootstrap postgres -> gen_user ADMIN only, never INHERIT/SET.
 * It does not authenticate a merchant or turn TEST into database row-level isolation.
 */
export async function verifyPaymentReconciliationDatabase(db,{database,publicationTest=false,specialistAccountTest=false}={}) {
 try {
  if(!validDatabase(database)||typeof publicationTest!=='boolean'||typeof specialistAccountTest!=='boolean'||specialistAccountTest&&!publicationTest)throw new Error('Invalid reconciliation target');
  const plan=approved();
  await db.transaction(async tx=>{
   if(publicationTest)await tx.query('set transaction isolation level repeatable read');
   await tx.query("set local statement_timeout='5s'");
   await tx.query("set local lock_timeout='1s'");
   await tx.query('set local search_path=pg_catalog');
   const identity=(await tx.query(`select current_user as name,session_user as login,current_database() as database,
    current_setting('server_version_num')::integer as version,current_setting('transaction_read_only') as readonly,
    current_setting('session_replication_role') as replication,rolsuper,rolcreatedb,rolcreaterole,rolinherit,rolreplication,rolbypassrls,rolcanlogin,rolconnlimit,
    exists(select 1 from pg_auth_members m where (m.roleid=r.oid or m.member=r.oid) and not (
     m.roleid=r.oid and m.admin_option and not m.inherit_option and not m.set_option and
     exists(select 1 from pg_roles issuer join pg_roles grantor on grantor.oid=m.grantor
      where issuer.oid=m.member and issuer.rolname='gen_user' and issuer.rolcreaterole and not issuer.rolsuper
       and grantor.rolname='postgres' and grantor.rolsuper)
    )) as membership,
    has_database_privilege(current_database(),'CONNECT') as connect,
    has_database_privilege(current_database(),'CREATE,TEMP,CONNECT WITH GRANT OPTION') as database_extra,
    has_parameter_privilege('session_replication_role','SET,ALTER SYSTEM') as replication_override,
    to_regclass('app.payment_refund_reservations') is not null as refund_installed
    from pg_roles r where rolname=current_user`)).rows[0];
   if(!identity||identity.name!==role||identity.login!==role||identity.database!==database||identity.version<180000||identity.version>=190000||
    identity.readonly!=='on'||identity.replication!=='origin'||identity.rolcanlogin!==true||identity.rolconnlimit!==4||identity.connect!==true||
    ['rolsuper','rolcreatedb','rolcreaterole','rolinherit','rolreplication','rolbypassrls','membership','database_extra','replication_override'].some(key=>identity[key]!==false))throw new Error('Invalid role');
   const journal=(await tx.query('select name,sha256 from blizhniy_meta.migrations order by name')).rows;
   // Only complete known releases: 0024, 0025, reviewed0032/0033 or pinned refund0054/0055.
   // Unknown intermediate versions and changed hashes remain fail-closed.
   const cabinetJournal=[...getBootstrapPlan({includeListingContactMethod:true}),...getCabinetMigrationPlan()];
   const deletionJournal=[...cabinetJournal,{name:'0033-account-deletion.sql',sha256:'8d0159c6af65c4c66aabb123695110f402fd5eac268fa2a879d97c85e628ed2f'}];
   const schema=journal.length===55?55:54;
   const refundJournal=publicationTest?[]:getRefundWorkerRolePlan(database,{schema}).journal,refundSchema=!publicationTest&&journal.length===refundJournal.length;
   if(identity.refund_installed!==refundSchema)throw new Error('Refund schema and journal disagree');
   const cabinetSchema=publicationTest||refundSchema||journal.length===cabinetJournal.length||journal.length===deletionJournal.length;
   const expectedJournal=publicationTest?getPublicationTestMigrationPlan():refundSchema?refundJournal:journal.length===deletionJournal.length?deletionJournal:journal.length===cabinetJournal.length?cabinetJournal:journal.length===plan.length+1?getBootstrapPlan({includeListingContactMethod:true}):plan;
   const specialistTerms=publicationTest&&await hasSpecialistCheckoutObjects(tx);
   const inbox=publicationTest&&await hasInboxPreferenceObjects(tx);
   const enrollment=publicationTest&&(await tx.query(`select to_regclass('app.specialist_test_enrollment') is not null
    or exists(select 1 from pg_proc where pronamespace='app'::regnamespace and proname in ('check_specialist_test_dispatch','require_specialist_test_terms')) as installed`)).rows[0].installed;
   if(enrollment&&!specialistTerms||specialistAccountTest&&!enrollment)throw Error('Missing specialist TEST schema');
   if(specialistTerms)expectedJournal.push(getSpecialistCheckoutMigration());
   if(inbox)expectedJournal.push(getInboxPreferenceMigration());
   if(enrollment)expectedJournal.push(getSpecialistAccountTestMigration());
   if(journal.length!==expectedJournal.length||journal.some((item,index)=>item.name!==expectedJournal[index].name||item.sha256!==expectedJournal[index].sha256))throw new Error('Invalid journal');
   if(refundSchema)await assertRefundSchema(tx,schema);
   if(publicationTest)await assertPublicationTestSchema(tx);
   if(specialistTerms||inbox)await assertExtendedPublicationTestSchema(tx,{specialist:specialistTerms,inbox,enrollment});
   await assertFinancialCatalogPrivileges(tx);
   const actual=(await tx.query(`select n.nspname||'.'||c.relname||'.'||a.attname||':'||p.privilege as key,
    has_column_privilege(c.oid,a.attnum,p.privilege||' WITH GRANT OPTION') as grantable
    from pg_class c join pg_namespace n on n.oid=c.relnamespace join pg_attribute a on a.attrelid=c.oid
    cross join (values('SELECT'),('INSERT'),('UPDATE'),('REFERENCES')) as p(privilege)
    where n.nspname not in ('pg_catalog','information_schema') and c.relkind in ('r','p','v','m','f','t')
     and a.attnum>0 and not a.attisdropped and has_column_privilege(c.oid,a.attnum,p.privilege) limit 10001`)).rows;
   const expected=new Set(Object.entries(publicationTest?publicationPolicy:cabinetSchema?cabinetPolicy:policy).flatMap(([table,access])=>Object.entries(access).flatMap(([privilege,names])=>names.map(name=>`${table}.${name}:${privilege.toUpperCase()}`))));
   // While rolling out or disabling specialist purchases, only this single additional read is permitted.
   const termsRead='app.specialist_checkout_terms.intent_id:SELECT';
   if(enrollment&&(specialistAccountTest||actual.some(item=>item.key===termsRead)))expected.add(termsRead);
   if(actual.length!==expected.size||actual.some(item=>item.grantable!==false||!expected.delete(item.key))||expected.size)throw new Error('Invalid column privileges');
   const dangerous=await tx.query(`select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname not in ('pg_catalog','information_schema') and
     ((c.relkind in ('r','p','v','m','f','t') and has_table_privilege(c.oid,'DELETE,TRUNCATE,TRIGGER,MAINTAIN')) or
      (c.relkind='S' and has_sequence_privilege(c.oid,'USAGE,SELECT,UPDATE'))) limit 1`);
   const functions=await tx.query(`select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname not in ('pg_catalog','information_schema') and has_function_privilege(p.oid,'EXECUTE') limit 1`);
   if(dangerous.rows.length||functions.rows.length)throw new Error('Invalid object privileges');
   const guardBody=plan.at(-1).sql.match(/as \$\$([\s\S]*?)\$\$;/)?.[1];
   if(!guardBody)throw new Error('Invalid guard source');
   const guards=(await tx.query(`select c.relname as name,t.tgenabled,t.tgtype,t.tgnargs,t.tgattr::text as attributes,
    t.tgqual is null as unconditional,p.prosrc,p.prosecdef,p.proconfig,l.lanname
    from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
    join pg_proc p on p.oid=t.tgfoid join pg_language l on l.oid=p.prolang
    where n.nspname='app' and c.relname=any($1::text[]) and t.tgname='reconciliation_lock_only'
     and not t.tgisinternal and p.oid='app.guard_reconciliation_locks()'::regprocedure`,[publicationTest?[...locks,'specialist_categories']:locks])).rows;
   const lockCount=locks.length+(publicationTest?1:0);
   if(guards.length!==lockCount||new Set(guards.map(item=>item.name)).size!==lockCount||guards.some(item=>
    item.tgenabled!=='A'||item.tgtype!==19||item.tgnargs!==0||item.attributes!==''||item.unconditional!==true||
    item.prosrc!==guardBody||item.prosecdef!==false||item.lanname!=='plpgsql'||JSON.stringify(item.proconfig)!==JSON.stringify(['search_path=""'])))throw new Error('Invalid lock guards');
  },{readOnly:true});
 }catch {throw new Error('Payment reconciliation database preflight failed');}
}
