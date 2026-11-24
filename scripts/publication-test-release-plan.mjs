import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {getBootstrapPlan} from './postgres-migration-plan.mjs';
import {getCabinetMigrationPlan} from './cabinet-release-plan.mjs';
import {verifySpecialistCheckoutRuntimeAccess} from './specialist-checkout-release.mjs';
import {readRefundSchema} from './refund-worker-schema.mjs';
const suffix=[
 ['0033-account-deletion.sql','8d0159c6af65c4c66aabb123695110f402fd5eac268fa2a879d97c85e628ed2f'],
 ['0034-checkout-edit-fence.sql','365cdd4a850aa67d334cff3dbed68cbfd6eff69e5c06643740bc1be02ad63df3'],
 ['0044-work-owner-actions.sql','4e3f137c8dbc2e98ceece3ca4025e64f0270467c69774bd890c20f28d5c1a04f'],
 ['0059-test-placement-guards.sql','8a9402d87aa417242f8cfb8e9200f61b15e9613e35e86de19811d8e8815c6c3c'],
];
export function paymentMigrationDirectory(name){
 return /^00(?:59|60|64|65|66|67)-/.test(name)?'candidates':'migrations';
}
function readReleaseMigration(name,sha256){
 const directory=paymentMigrationDirectory(name);
 const sql=readFileSync(new URL('../database/'+directory+'/'+name,import.meta.url),'utf8');
 if(createHash('sha256').update(sql).digest('hex')!==sha256)throw Error('Publication TEST migration changed');
 return{name,sha256,sql};
}
export function getSpecialistAccountTestMigration(){
 return readReleaseMigration('0065-specialist-account-test.sql','8c7930b01d332097c50f740f55ca6f7d0566b51127ef79741b2f6bdd494cf8fd');
}
export function getPaidResponseMigrations(){return [readReleaseMigration('0046-response-checkout-fence.sql','d3313c7bc349ec8c93d7927bc0b69ed9fbb1a19c69b169af4181f482d03c8d5f'),
  readReleaseMigration('0067-paid-response-test.sql','c8cf0612d68fe541dc05d74c904b6d855b64166940bc12db1f316ca77c33bd29')];}
export function getListingViewsMigration(){
 return readReleaseMigration('0066-listing-views.sql','8528c22082f00fe5340f0c9480dec383e7999d75d90c65142f22e5472f83481c');
}
export function getBookingLifecycleMigration(){
 return readReleaseMigration('0041-booking-lifecycle.sql','e1c4e29db17d7ae0f61e440d0dc42433dff9bd2854142a9c59f236d97bc13748');
}
export function getInboxPreferenceMigration(){
 return readReleaseMigration('0064-inbox-notification-preferences.sql','eb6c5e253e0776a814daf039276d61a294bda16b680ce9c731eafc3a71da9967');
}
/** Known production suffix, not the unrelated full local refund schema. No execution or credentials. */
export function getPublicationTestMigrationPlan(){
 return [...getBootstrapPlan({includeListingContactMethod:true}),...getCabinetMigrationPlan(),...suffix.map(([name,hash])=>readReleaseMigration(name,hash))];
}
export async function assertPublicationTestSchema(tx){
 const definitions=new Map();
 for(const migration of getPublicationTestMigrationPlan().filter(({name})=>name.startsWith('0044-')||name.startsWith('0059-')))
  for(const match of migration.sql.matchAll(/create (?:or replace )?function app\.([a-z_]+)\(\) returns trigger[\s\S]*?as \$\$([\s\S]*?)\$\$;/g))definitions.set(match[1],match[2]);
 if(definitions.size!==4)throw Error('Publication TEST guard source unavailable');
 const expected=new Map([
  ['listings.listing_checkout_edit_fence',['guard_checkout_edit',19]],['work_publications.work_checkout_edit_fence',['guard_checkout_edit',19]],
  ['listing_photos.listing_checkout_photo_fence',['guard_checkout_photo_edit',31]],['work_publication_photos.work_checkout_photo_fence',['guard_checkout_photo_edit',31]],
  ['work_owner_actions.work_owner_action_guard',['apply_work_owner_action',31]],['work_owner_actions.work_owner_action_truncate_guard',['apply_work_owner_action',34]],
  ['work_owner_actions.work_owner_action_effect',['apply_work_owner_action_effect',5]],
 ]);
 const rows=(await tx.query(`select c.relname||'.'||t.tgname as name,p.proname,t.tgenabled,t.tgtype,t.tgnargs,t.tgattr::text as attributes,
  t.tgqual is null as unconditional,p.prosrc,p.prosecdef,p.proconfig,l.lanname
  from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
  join pg_proc p on p.oid=t.tgfoid join pg_namespace pn on pn.oid=p.pronamespace join pg_language l on l.oid=p.prolang
  where n.nspname='app' and pn.nspname='app' and c.relname||'.'||t.tgname=any($1::text[]) and not t.tgisinternal`,[[...expected.keys()]])).rows;
 if(rows.length!==expected.size)throw Error('Publication TEST guards unavailable');
 for(const row of rows){
  const spec=expected.get(row.name);if(!spec||row.proname!==spec[0]||row.tgtype!==spec[1]||row.tgenabled!=='A'||row.tgnargs!==0||row.attributes!==''||!row.unconditional||
   row.prosrc!==definitions.get(spec[0])||row.prosecdef!==true||row.lanname!=='plpgsql'||JSON.stringify(row.proconfig)!==JSON.stringify(['search_path=""']))throw Error('Publication TEST guard changed');
  expected.delete(row.name);
 }
 if(expected.size)throw Error('Publication TEST guard missing');
}

// PostgreSQL 18 emits different parentheses for six existing CHECK constraints after a logical restore.
// Each pair pins the full installed and restored app catalog for exactly one reviewed journal.
const fingerprints={
 hostedViews:[
  'c073b3831838b1e1f636ed7ffa9eb6151b1b66c09a8bdfeb8c33c345aa34a134',
  '87309c9a47de7cbfe8067d5565dac20cbd1fdf6be8eb82bbb29e856da16d4c47',
 ],
 hostedBookingsAndViews:[
  '0dd61d32c5ed846eedee8523f6a488c6b0a16b10cff7108cb330aa7c8badcb02',
  '9cd81b97983d0d711868826900d536d6f2137814fae50913770a9359f017c534',
 ],
 hostedResponsesWithBookingsAndViews:[
  '9cb2c59fa1ac914d8d52a04f06f3f92564211f8147dc80f3357f6db3c27cc44e',
  '9852fdc714d49d8aa741fe332403ad8fa3a227ee2d8499e72243adbf2e709db8',
 ],
 // Installed booking lifecycle on the hosted specialist + inbox schema with both Telegram policies.
 hostedBookings:[
  '8862e3be03ed77e651f0dc57895efcc4770a9489af23d57e93c0059f134fb0af',
  'cc1171a8d97335a845a086bebc66dabe40d10b877bb8f5ebc1d3dcdd2a1ccf3b',
 ],
 specialistTest:[
  '650acb3a120b7b6766fbc608ad9e406df3b30695fffc83b476a21a22df14ec9e',
  'be6b6dcdd791e894ca73e64dd4e1dacaf941011eb3912dca3fcdb70f1c8c4b0e',
 ],
 specialistTestInbox:[
  // Logical restore of the hosted schema with the two Telegram policies.
  'ee0258321a63ac59056a2835694e98885142ad2c35a83f6ff2a09b58a5050bf2',
  // Hosted PostgreSQL with both owner-scoped policies from permissions/telegram-phone.sql.
  '3a578e10cdf00668dfc78d3966fda0e5d1c513162587ef9826744d70cc38696c',
  'dc37198d436e0a28308687825a0089810709bdc2251a78c4f07b3abb5f798a3b',
  '9a0a35503e808d42b70095e607abd2ca67db80c2d52c9fe6f0ea1d52f9ed0d87',
 ],
 specialist:[
  '0bc0e095bf25c88c2d067b61a936cd26128fb0133ec2b3a7103c3a0624db3a29',
  '73259fcbf96156dd36c905f6ebeead1d3b50d2dfb251a3b4c5af33351754e25d',
 ],
 inbox:[
  '8a9b24052beb467d907b23c7ac5ac616a39089c876a1ebf3c8a5b104e4e993d8',
  '26799994d424c440cbba2a78fbc9e76bec35d9ba9c2f5a2cf2443c008d237de1',
 ],
 both:[
  '35b9bac763896beb90ef302e7ba24fc02a451a04148b8d3e8174187acccae28c',
  '3fbe9a063f9ebd0673c9c8c35fd91fba6605b47407f913aed080f5e0ea3772cf',
 ],
};
export async function hasInboxPreferenceObjects(tx){
 const result=await tx.query(`select exists(select 1 from pg_proc where pronamespace='app'::regnamespace and proname='apply_inbox_preference')
  or exists(select 1 from pg_trigger where tgrelid='app.notifications'::regclass and tgname='apply_inbox_preference') as installed`);
 return result.rows[0].installed;
}
export async function assertListingViewsAccess(tx){
 const catalog=await readRefundSchema(tx,{namespace:'app_stats'});
 const hash=createHash('sha256').update(JSON.stringify(catalog)).digest('hex');
 if(hash!=='4a7de678206ac4c93e294352275bbd540670cec0c04640c8cadcd1b66acb56bb')throw Error('Unexpected listing views schema');
 // The object fingerprint covers definitions. Audit ACLs separately, including column grants.
 const {rows:[access]}=await tx.query(`with ns as (
  select oid,nspowner,nspacl from pg_namespace where nspname='app_stats'
 ), objects(kind,owner,acl) as (
  select 'namespace',nspowner,coalesce(nspacl,acldefault('n',nspowner)) from ns
  union all select 'relation',relowner,coalesce(relacl,acldefault('r',relowner))
   from pg_class join ns on relnamespace=ns.oid
  union all select 'column',relowner,attacl from pg_attribute join pg_class on attrelid=pg_class.oid
   join ns on relnamespace=ns.oid where attacl is not null
  union all select 'function',proowner,coalesce(proacl,acldefault('f',proowner)) from pg_proc join ns on pronamespace=ns.oid
 ) select ns.nspowner=(select nspowner from pg_namespace where nspname='app') as same_owner,
  not exists(select 1 from pg_default_acl where defaclnamespace=ns.oid) as clean_defaults,
  array(select kind||':'||privilege_type from objects cross join lateral aclexplode(acl) a where grantee<>owner
   and grantor=owner and grantee='blizhniy_runtime'::regrole and not is_grantable order by 1) as runtime,
  not exists(select 1 from objects cross join lateral aclexplode(acl) a where grantee<>owner and
   (grantor<>owner or grantee<>'blizhniy_runtime'::regrole or is_grantable)) as clean_grants
 from ns`);
 if(access?.same_owner!==true||access.clean_defaults!==true||access.clean_grants!==true||
    JSON.stringify(access.runtime)!==JSON.stringify(['function:EXECUTE','namespace:USAGE']))throw Error('Unexpected listing views permissions');
}
export async function assertExtendedPublicationTestSchema(tx,{specialist,inbox,enrollment=false,bookings=false,views=false,responses=false}){
 const catalog=await readRefundSchema(tx);
 const hash=createHash('sha256').update(JSON.stringify(catalog)).digest('hex');
 const key=enrollment?(inbox?'specialistTestInbox':'specialistTest'):specialist&&inbox?'both':specialist?'specialist':'inbox';
 let accepted=fingerprints[key];
 if(bookings)accepted=fingerprints.hostedBookings;
 if(views)accepted=bookings?fingerprints.hostedBookingsAndViews:fingerprints.hostedViews;
 if(responses){
  if(!enrollment||!inbox||bookings!==views)throw Error('Unsupported paid response deployment');
  accepted=bookings?fingerprints.hostedResponsesWithBookingsAndViews:
   ['2579247a7ee000f9f19ca48ecd7840943e59ace243fc593d4eb75b911f690193','22da33391304b83654362983c0b4c5cd4953a7c08e859347aa5a5d53e7116ade'];
 }
 if(!accepted.includes(hash))throw Error('Unexpected extended publication TEST schema');
 if(views)await assertListingViewsAccess(tx);
 if(specialist)await verifySpecialistCheckoutRuntimeAccess(tx);
 if(enrollment){
  // Catalog fingerprints cover definitions. Ownership-only access also includes explicit column grants.
  const unexpected=await tx.query(`with enrollment as (
   select oid,relowner,relacl from pg_class where oid='app.specialist_test_enrollment'::regclass
  ), terms as (
   select oid,relowner,relacl from pg_class where oid='app.specialist_checkout_terms'::regclass
  ) select 1 from enrollment e cross join lateral aclexplode(coalesce(e.relacl,acldefault('r',e.relowner))) a where a.grantee<>e.relowner
   union all select 1 from enrollment e join pg_attribute c on c.attrelid=e.oid cross join lateral aclexplode(c.attacl) a where a.grantee<>e.relowner
   union all select 1 from terms t cross join lateral aclexplode(coalesce(t.relacl,acldefault('r',t.relowner))) a where a.grantee<>t.relowner
   union all select 1 from terms t join pg_attribute c on c.attrelid=t.oid cross join lateral aclexplode(c.attacl) a
    where a.grantee<>t.relowner and (a.is_grantable or not (
      (a.grantee='blizhniy_runtime'::regrole and ((c.attname in ('intent_id','created_at') and a.privilege_type='SELECT')
       or (c.attname='intent_id' and a.privilege_type='INSERT')))
      or (a.grantee='blizhniy_payment_reconciler'::regrole and c.attname='intent_id' and a.privilege_type='SELECT')
    ))
   union all select 1 from pg_proc p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
    where p.pronamespace='app'::regnamespace and p.proname=any($1::text[]) and a.grantee<>p.proowner limit 1`,
   [['check_specialist_test_dispatch','require_specialist_test_terms','guard_specialist_checkout_terms','guard_specialist_payment_fulfillment','guard_specialist_publication_window','guard_phone_wait_job']]);
  if(unexpected.rows.length)throw Error('Unexpected specialist TEST object access');
 }
 if(inbox){
  const extra=await tx.query(`select 1 from pg_proc p cross join lateral
   aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl
   where p.oid='app.apply_inbox_preference()'::regprocedure and acl.grantee<>p.proowner limit 1`);
  if(extra.rows.length)throw Error('Unexpected inbox function access');
 }
}
