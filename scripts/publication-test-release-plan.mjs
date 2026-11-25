import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {getBootstrapPlan} from './postgres-migration-plan.mjs';
import {getCabinetMigrationPlan} from './cabinet-release-plan.mjs';
import {getSpecialistCheckoutMigration,verifySpecialistCheckoutRuntimeAccess} from './specialist-checkout-release.mjs';
import {readRefundSchema} from './refund-worker-schema.mjs';
import {assertPaidResponseSchema} from './paid-response-schema.mjs';
const suffix=[
 ['0033-account-deletion.sql','8d0159c6af65c4c66aabb123695110f402fd5eac268fa2a879d97c85e628ed2f'],
 ['0034-checkout-edit-fence.sql','365cdd4a850aa67d334cff3dbed68cbfd6eff69e5c06643740bc1be02ad63df3'],
 ['0044-work-owner-actions.sql','4e3f137c8dbc2e98ceece3ca4025e64f0270467c69774bd890c20f28d5c1a04f'],
 ['0059-test-placement-guards.sql','8a9402d87aa417242f8cfb8e9200f61b15e9613e35e86de19811d8e8815c6c3c'],
];
const hostedRefundSuffix=[
 ['0035-application-contact-views.sql','b1fa39ecfda0d9bcfb7dce27650e7950fc652db58af88b9756ed5979636ac937'],
 ['0036-placement-refund-reservations.sql','3ec8c25243195d8b9d9c36e2c738249c815060c436dbcc4860eb263faf48ef16'],
 ['0037-refund-requests.sql','6914c52b6f50153c63068f01ad14fad69a54b121c10d977986766249593742c3'],
 ['0038-refund-journal.sql','fbab09446f30129bbc4fe59fbd4432f0e5d1ec76429b16bc5220cca7f15da240'],
 ['0039-refund-dispatch.sql','e29f2cecbf97930c9c8c7be9aaa6d6031902ef44c232cabfd1517c839f285bd4'],
 ['0040-placement-refund-effects.sql','470b5106cf78ad96f5005eda6744e962c557c4cff2582fbf1adeca6cc5cb9b41'],
 ['0042-placement-refund-approvals.sql','99defa302ee7201e5a0968005c3aab04a9fa95a13fee8c1e7620925ac595959d'],
 ['0043-application-compensation-cases.sql','a6d295cde1792350ebceca844a5999f9ff7ec56949bc180081ea001dc4aee39e'],
 ['0045-customer-closure-compensation.sql','6fd9cef91fff541cb8dc8c67500ef467e93c594e3ae145d3f500d4cc93ce9621'],
 ['0048-application-compensation-refunds.sql','69ee78403b4a7f1ac40366b4802d0930b8f9919f2f5a93cd30a9b1946c3afe77'],
 ['0049-application-compensation-queue.sql','7840ca52cb4dda2285baf9bf117fa465f5903994902888a9963c98d51b748959'],
 ['0050-application-compensation-discovery.sql','70f8b364629be26a61758e8de0e0a05d4094d512094c968a1e03a4be0987054d'],
 ['0051-refund-recovery.sql','e24c75dc7183483c041e1679482968767a34aea04d1706464d1cf20e0c30a164'],
 ['0052-placement-refund-queue.sql','d075baa1eef117dc9b2db0588c6886af7fb7a0b3ed14482a0a1989b4110aedc4'],
 ['0053-application-compensation-lease.sql','fae70f623c932cccf8b3af5b0db6bcc02d362be804ffda3ba04ef8a3c54bb12d'],
 ['0054-refund-worker-locks.sql','58e0541d6519d37ade73c8b1cf14e28aaeb4846266c4618bad7186a52c3ec43b'],
 ['0055-refund-operator-locks.sql','eccf6f5c4208cbe48fa8d97e67528a14a8b169929ba19605422000385ffda79c'],
 ['0056-placement-renewals.sql','da97d79898e6f0b1471824822c60dead94a5f92c33f526127b230616d09c12e0'],
 ['0057-service-payment-terms.sql','564a485f53754b34293ccd25d664d4dfeea94379c149381218ff69bc728731da'],
 ['0075-hosted-refund-compatibility.sql','45ef880212da7927092fb91f82b113ec4ac73e8973b38fb150a051c32509a262'],
];
export function paymentMigrationDirectory(name){
 return /^00(?:59|60|64|65|66|67|71|72|73|75|76|78|79|80|81|82|83|84)-/.test(name)?'candidates':'migrations';
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
export function getCheckoutCancellationMigrations(){return [
 readReleaseMigration('0047-checkout-cancellation.sql','345d57e5b76bb36784260fdd49c56820323eda97bbc19e61bee06179cdf19d3d'),
 readReleaseMigration('0071-checkout-cancellation-test-policy.sql','45e1419181ce42bbd62a15f0511dfc7c6580c006fd0b6448d36a19935210a353'),
];}
export function getPaymentReconciliationRecoveryMigration(){
 return readReleaseMigration('0072-payment-reconciliation-recovery.sql','6861077937975d37c1eea75a1c9af325d749092fc22eab76ef612476ccbd3635');
}
export function getPaymentReconciliationAlertMigration(){
 return readReleaseMigration('0073-payment-reconciliation-alert.sql','113e66843caf8bf854b9ffe7deab4e6715e00c3c08171c6f2f3f804045b0a046');
}
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

export function getHostedRefundMigrationPlan(){
 return hostedRefundSuffix.map(([name,hash])=>readReleaseMigration(name,hash));
}

export function getUndeliveredResponseCompensationMigration(){
 return readReleaseMigration('0076-undelivered-response-compensation.sql','a150c8149f7cf84edf38fba6d36ad9a8b331c270cbec3e8db2db249e48c61dc9');
}

export function getHostedMarqueeRefundRecoveryMigration(){
 return readReleaseMigration('0078-hosted-marquee-refund-recovery.sql','3a633729d07a135cbf243127639aba765464976531e8aad2cd6f77144df8e6bc');
}

export function getHostedPlacementRefundProofMigration(){
 return readReleaseMigration('0079-hosted-placement-refund-proof.sql','76d9acf9a34e0f9d598ed8212e5fd8f7e9aad4472dff686369ab5d09fa8851f8');
}

export function getHostedSpecialistRefundMigration(){
 return readReleaseMigration('0080-hosted-specialist-refunds.sql','5b0c5e485f7493e8ee048ee856a6d9de310f8bb5a93553a7673611332cf9c681');
}

export function getHostedSpecialistRepeatMigration(){
 return readReleaseMigration('0081-hosted-specialist-repeat.sql','55aedc43d0a2f7ab021394ddf83632041f294757923c6543f816a45955ae2961');
}

export function getHostedPlacementRenewalMigration(){
 return readReleaseMigration('0082-hosted-placement-renewals.sql','49f893891d52a3dcd9acb98ebd701332b06133a0563c1475df2d320480821f0c');
}

export function getHostedMarqueeAdmissionMigration(){
 return readReleaseMigration('0083-hosted-marquee-admission.sql','dd0dfbde38533ae0bfab988116a77716380875ae0a5198837802133aeabf79cb');
}

export function getHostedMarqueeQueueMigration(){
 return readReleaseMigration('0084-hosted-marquee-queue.sql','19d9458c81e96834aa364e14278c4e033c8298fd4c5d6fd2e2a7b05c8eacd112');
}

export function getHostedRefundSchemaVersion(journal){
 switch(journal.at(-1)?.name){
  case '0084-hosted-marquee-queue.sql':return 84;
  case '0083-hosted-marquee-admission.sql':return 83;
  case '0082-hosted-placement-renewals.sql':return 82;
  case '0081-hosted-specialist-repeat.sql':return 81;
  case '0080-hosted-specialist-refunds.sql':return 80;
  case '0079-hosted-placement-refund-proof.sql':return 79;
  case '0078-hosted-marquee-refund-recovery.sql':return 78;
  case '0076-undelivered-response-compensation.sql':return 76;
  default:return 75;
 }
}

function hostedRefundBaseline(){
 return [...getPublicationTestMigrationPlan(),getSpecialistCheckoutMigration(),getInboxPreferenceMigration(),
  getSpecialistAccountTestMigration(),getBookingLifecycleMigration(),getListingViewsMigration(),...getPaidResponseMigrations(),
  ...getCheckoutCancellationMigrations(),getPaymentReconciliationRecoveryMigration(),getPaymentReconciliationAlertMigration()];
}

export function getHostedRefundReleasePlan(schema=75){
 if(![75,76,78,79,80,81,82,83,84].includes(schema))throw Error('Invalid hosted refund schema');
 const plan=[...hostedRefundBaseline(),...getHostedRefundMigrationPlan()];
 if(schema>=76)plan.push(getUndeliveredResponseCompensationMigration());
 if(schema>=78)plan.push(getHostedMarqueeRefundRecoveryMigration());
 if(schema>=79)plan.push(getHostedPlacementRefundProofMigration());
 if(schema>=80)plan.push(getHostedSpecialistRefundMigration());
 if(schema>=81)plan.push(getHostedSpecialistRepeatMigration());
 if(schema>=82)plan.push(getHostedPlacementRenewalMigration());
 if(schema>=83)plan.push(getHostedMarqueeAdmissionMigration());
 if(schema>=84)plan.push(getHostedMarqueeQueueMigration());
 return plan.sort((a,b)=>a.name.localeCompare(b.name,'en'));
}

// Preserve the published migration bytes and commit the compatibility definitions and journal together.
export function getHostedRefundMigrationSql(){
 return composeHostedRefundSql(hostedRefundBaseline(),getHostedRefundMigrationPlan());
}

export function getHostedRefundUpgradeSql(){
 return composeHostedRefundSql(getHostedRefundReleasePlan(),[getUndeliveredResponseCompensationMigration()]);
}

export function getHostedMarqueeRefundUpgradeSql(){
 return composeHostedRefundSql(getHostedRefundReleasePlan(76),[getHostedMarqueeRefundRecoveryMigration()]);
}

export function getHostedPlacementRefundProofUpgradeSql(){
 return composeHostedRefundSql(getHostedRefundReleasePlan(78),[getHostedPlacementRefundProofMigration()]);
}

export function getHostedSpecialistRefundUpgradeSql(){
 return composeHostedRefundSql(getHostedRefundReleasePlan(79),[getHostedSpecialistRefundMigration()]);
}

export function getHostedSpecialistRepeatUpgradeSql(){
 return composeHostedRefundSql(getHostedRefundReleasePlan(80),[getHostedSpecialistRepeatMigration()]);
}

export function getHostedPlacementRenewalUpgradeSql(){
 return composeHostedRefundSql(getHostedRefundReleasePlan(81),[getHostedPlacementRenewalMigration()]);
}

export function getHostedMarqueeAdmissionUpgradeSql(){
 return composeHostedRefundSql(getHostedRefundReleasePlan(82),[getHostedMarqueeAdmissionMigration()]);
}

export function getHostedMarqueeQueueUpgradeSql(){
 return composeHostedRefundSql(getHostedRefundReleasePlan(83),[getHostedMarqueeQueueMigration()]);
}

function composeHostedRefundSql(previous,plan){
 const baseline=previous.sort((a,b)=>a.name.localeCompare(b.name,'en')).map(({name,sha256})=>[name,sha256]);
 const body=plan.map(({sql})=>{
  if(!/^begin;$/m.test(sql)||!/^commit;\s*$/m.test(sql))throw Error('Invalid hosted refund migration transaction');
  return sql.replace(/^begin;$/m,'').replace(/\ncommit;\s*$/,'');
 }).join('\n');
 const entries=plan.map(({name,sha256})=>`('${name}','${sha256}')`).join(',\n');
 return `begin;
set local lock_timeout='3s';
set local statement_timeout='10s';
set local search_path=pg_catalog;
lock table blizhniy_meta.migrations in share row exclusive mode;
do $baseline$
begin
 if (select jsonb_agg(jsonb_build_array(name,sha256) order by name collate "C") from blizhniy_meta.migrations)
  is distinct from '${JSON.stringify(baseline)}'::jsonb then
  raise exception 'Unexpected hosted refund baseline' using errcode='55000';
 end if;
end $baseline$;
${body}
insert into blizhniy_meta.migrations(name,sha256) values
${entries};
commit;
`;
}

export async function assertHostedRefundRelease(tx,journal){
 const schema=getHostedRefundSchemaVersion(journal),marqueeRefunds=schema>=78,placementRefundProof=schema>=79,specialistRefunds=schema>=80,specialistRepeat=schema>=81,placementRenewals=schema>=82,marqueeAdmission=schema>=83,marqueeQueue=schema>=84;
 const expected=getHostedRefundReleasePlan(schema).map(({name,sha256})=>({name,sha256}));
 if(JSON.stringify(journal)!==JSON.stringify(expected))throw Error('Invalid hosted refund journal');
 await assertPaidResponseSchema(tx);
 await assertExtendedPublicationTestSchema(tx,{specialist:true,inbox:true,enrollment:true,bookings:true,views:true,
  responses:true,cancellations:true,recovery:true,reconciliationAlert:true,hostedRefunds:true,undeliveredCompensation:schema>=76,marqueeRefunds,placementRefundProof,specialistRefunds,specialistRepeat,placementRenewals,marqueeAdmission,marqueeQueue});
 return schema;
}
export async function assertPublicationTestSchema(tx,{hostedRefunds=false}={}){
 const definitions=new Map();
 for(const migration of getPublicationTestMigrationPlan().filter(({name})=>name.startsWith('0044-')||name.startsWith('0059-')))
  for(const match of migration.sql.matchAll(/create (?:or replace )?function app\.([a-z_]+)\(\) returns trigger[\s\S]*?as \$\$([\s\S]*?)\$\$;/g))definitions.set(match[1],match[2]);
 if(definitions.size!==4)throw Error('Publication TEST guard source unavailable');
 if(hostedRefunds){
  const renewal=getHostedRefundMigrationPlan().find(item=>item.name==='0056-placement-renewals.sql');
  const body=renewal?.sql.match(/create or replace function app\.apply_work_owner_action\(\) returns trigger[\s\S]*?as \$\$([\s\S]*?)\$\$;/)?.[1];
  if(!body)throw Error('Renewal guard source unavailable');
  definitions.set('apply_work_owner_action',body);
 }
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
 hostedMarqueeQueue:[
  '7e9c2fb158ce975bba673d949767c058915e434c238868b3d0bd5a36c46297b6',
  '2f04539435c04571e97be26006b95c62df22f9dabcc0928f73153e59f395c047',
 ],
 hostedMarqueeAdmission:[
  '2d2305c4c46a248c76a70b2fa19c3994229ed8cef1cfe8d7644f0da115f82c78',
  '07704262038114948a46eaab23b683237a7c3972c657ed58e7581cf80e8e7171',
 ],
 hostedPlacementRenewals:[
  'e39b396a801544c7588a3191e82c30218d9e05c52e900ff6e44f00c67aa923ee',
  '4f90458b71f6658b06cbb0d82e50d7fb9304e353d502b2bbc812ffdb94063603',
 ],
 hostedSpecialistRepeat:[
  '85ee3173ac4abc2032fe8bedc4f24ed7dbca260bea28afc048b1ec9c69060306',
  'da3d5d1fb572c5df80acc173d18b9eed977c47b8ca4e495530bc812cfd9f1dfe',
 ],
 hostedRefundsWithSpecialist:[
  '72250ece8dac59eababf86f36796cdaeebad836ff1b56dce631f11d824746ed0',
  'b57f5f1dd951a768632455a0061a89936ffeda21032b6ead7b8367414d54af79',
 ],
 hostedRefundsWithPlacementProof:[
  '24fc5a3a6f5d3be7cd30f26abfe1c2f30510691567ec51a85faf71977771a045',
  '47a53380044cfc1f78f69ec3245da135095f45a6c822cb9147affc3b5519952f',
 ],
 hostedRefundsWithMarquee:[
  '15c6959aa9a0cb646f1cf16990b229b570da4a1b8cbf195cc5c38615bf6e3b7f',
  '4591d186a888bc7b14ff4e3e976ca77ecbc50128351c5b1204bcc8c33a1d98e8',
 ],
 hostedRefundsWithUndeliveredCompensation:[
  'e0fb46d76167c2b79dd90fc70cca501db1ad6e957a4b1253867c73bd70ffd4ac',
  '7ca68364fe8ca3185495e45b4556ef47ffd536cf8dbcae7a22962c0e6c6f4a09',
 ],
 hostedRefunds:[
  '05c41875cb2a2c427355006772ce1dd06e3553b72165d2ca76b160aa7fe315ee',
  'ef648b63d1b29212e690b44ccba7fcdc89f4561f9d0c0cbde862e789ce52d611',
 ],
 reconciliationAlert:[
  '958422d3803782550bba09ab98477bec184658ae0dfaed37ba5974d53baef867',
  '397c41f8fdf0adaea3fac474611afaa3260fbebe10d68d48e640a5e8e598483d',
 ],
 reconciliationRecovery:[
  '5f7177acdb04430728b95703839408ef9a88515f7983477a631fb5f8ffdb6207',
  'cdff5fa4d8959407f4506a207bc770fad44424b8af7215b3d0943ef6cb89c92e',
 ],
 checkoutCancellation:[
  '1cce0943295d08fc90d8a0ba871a0ef59aaa24f0431ce682f6dc298442deebf4',
  'e0585855492f7cd06c46b3895bcd40360555671b8cf9e800628f38984cffbcff',
 ],
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
async function assertHostedMarqueeAdmissionAccess(tx){
 const actual=(await tx.query(`with relations as (
  select oid,relowner,relname,relacl from pg_class where oid in ('app.marquee_test_enrollment'::regclass,
   'app.marquee_test_admissions'::regclass,'app.service_payment_terms'::regclass)
 )
 select r.relname||'.*:'||a.grantee::regrole::text||':'||a.privilege_type as key,a.is_grantable as grantable
  from relations r cross join lateral aclexplode(coalesce(r.relacl,acldefault('r',r.relowner))) a where a.grantee<>r.relowner
 union all select r.relname||'.'||c.attname||':'||a.grantee::regrole::text||':'||a.privilege_type,a.is_grantable
  from relations r join pg_attribute c on c.attrelid=r.oid cross join lateral aclexplode(c.attacl) a where a.grantee<>r.relowner
 union all select p.proname||':'||a.grantee::regrole::text||':'||a.privilege_type,a.is_grantable
  from pg_proc p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
  where p.pronamespace='app'::regnamespace and p.proname in ('guard_marquee_test_admission','require_hosted_marquee_terms',
   'service_payment_eligible','service_payment_eligible_before_marquee_admission') and a.grantee<>p.proowner`)).rows;
 const expected=new Set(['marquee_test_admissions.intent_id:blizhniy_runtime:SELECT','marquee_test_admissions.intent_id:blizhniy_runtime:INSERT',
  'marquee_test_admissions.intent_id:blizhniy_payment_reconciler:SELECT','service_payment_terms.intent_id:blizhniy_runtime:INSERT',
  ...['intent_id','fair_date','fair_ends_at'].map(column=>'service_payment_terms.'+column+':blizhniy_runtime:SELECT')]);
 if(actual.length!==expected.size||actual.some(row=>row.grantable!==false||!expected.delete(row.key))||expected.size)throw Error('Unexpected marquee admission access');
}
async function assertCheckoutCancellationAccess(tx){
 const result=(await tx.query(`with relations as (
  select oid,relowner,relacl,relname='payment_checkout_cancellations' as journal from pg_class
  where oid in ('app.payment_checkout_cancellations'::regclass,'app.checkout_cancellation_test_enrollment'::regclass)
 ), unexpected as (
  select 1 from relations r cross join lateral aclexplode(coalesce(r.relacl,acldefault('r',r.relowner))) a
   where a.grantee<>r.relowner and not (r.journal and a.grantee='blizhniy_runtime'::regrole and a.privilege_type='SELECT' and not a.is_grantable)
  union all select 1 from relations r join pg_attribute c on c.attrelid=r.oid cross join lateral aclexplode(c.attacl) a
   where a.grantee<>r.relowner and not (
    r.journal and c.attname='payment_id' and a.grantee='blizhniy_runtime'::regrole and a.privilege_type='INSERT' and not a.is_grantable)
  union all select 1 from pg_proc p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
   where p.pronamespace='app'::regnamespace and p.proname in (
    'guard_checkout_cancellation','apply_checkout_cancellation','guard_cancelled_checkout_dispatch','checkout_cancellation_admitted'
   ) and a.grantee<>p.proowner
 ) select not exists(select 1 from unexpected)
  and has_table_privilege('blizhniy_runtime','app.payment_checkout_cancellations','SELECT')
  and has_column_privilege('blizhniy_runtime','app.payment_checkout_cancellations','payment_id','INSERT')
  and not has_column_privilege('blizhniy_runtime','app.payment_orders','status','UPDATE') as valid`)).rows[0];
 if(result?.valid!==true)throw Error('Unexpected checkout cancellation access');
}

async function assertReconciliationCommandAccess(tx,monitor=false){
 const login=monitor?'blizhniy_reconciliation_monitor':'blizhniy_reconciliation_operator';
 const commands=monitor?['app.payment_reconciliation_alert_needed(text)']:[
  'app.recover_payment_reconciliation(text,uuid,uuid,uuid,text,text,boolean)',
  'app.read_payment_reconciliation_recovery_status(text,uuid,text)',
 ];
 const protectedNames=commands.map(signature=>signature.slice(4,signature.indexOf('(')));
 if(!monitor)protectedNames.push('require_reconciliation_administrator','preserve_reconciliation_recovery_budget');
 const result=(await tx.query(`with operator as (
  select oid from pg_roles r where rolname=$1 and rolcanlogin
   and not (rolsuper or rolcreatedb or rolcreaterole or rolinherit or rolreplication or rolbypassrls)
   and not exists(select 1 from pg_auth_members m where m.member=r.oid or m.roleid=r.oid)
 ), commands as (
  select to_regprocedure(signature)::oid as oid from unnest($2::text[]) signature
 ), private_audit as (
  select oid,relowner,relacl from pg_class where oid='app.payment_reconciliation_recoveries'::regclass
 ), forbidden as (
  select 1 from private_audit r cross join lateral aclexplode(coalesce(r.relacl,acldefault('r',r.relowner))) a where a.grantee<>r.relowner
  union all select 1 from private_audit r join pg_attribute c on c.attrelid=r.oid cross join lateral aclexplode(c.attacl) a
   where a.grantee<>r.relowner
  union all select 1 from pg_proc p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
   where p.pronamespace='app'::regnamespace and p.proname=any($3::text[]) and a.grantee<>p.proowner and not (
    a.grantee=(select oid from operator) and p.oid in (select oid from commands) and a.privilege_type='EXECUTE' and not a.is_grantable)
 ) select exists(select 1 from operator o
  where has_database_privilege(o.oid,current_database(),'CONNECT')
   and not has_database_privilege(o.oid,current_database(),'CREATE,TEMP,CONNECT WITH GRANT OPTION')
   and has_schema_privilege(o.oid,'app','USAGE')
   and not exists(select 1 from pg_namespace n where
    has_schema_privilege(o.oid,n.oid,'CREATE,USAGE WITH GRANT OPTION') or
    (n.nspname not in ('app','pg_catalog','information_schema','public') and has_schema_privilege(o.oid,n.oid,'USAGE')))
   and not exists(select 1 from commands c where has_function_privilege(o.oid,c.oid,'EXECUTE') is distinct from true)
   and not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname not in ('pg_catalog','information_schema') and p.oid not in(select oid from commands)
     and has_function_privilege(o.oid,p.oid,'EXECUTE'))
   and not exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname not in ('pg_catalog','information_schema')
    and ((c.relkind in ('r','p','v','m','f','t') and (
     has_any_column_privilege(o.oid,c.oid,'SELECT,INSERT,UPDATE,REFERENCES') or
     has_table_privilege(o.oid,c.oid,'DELETE,TRUNCATE,TRIGGER,MAINTAIN')))
     or (c.relkind='S' and has_sequence_privilege(o.oid,c.oid,'USAGE,SELECT,UPDATE'))))
 ) and not exists(select 1 from forbidden) as valid`,[login,commands,protectedNames])).rows[0];
 if(result?.valid!==true)throw Error('Unexpected reconciliation command access');
}

async function assertReconcilerFunctionAccess(tx,signature){
 const rights=(await tx.query(`select a.grantee::regrole::text as role,a.privilege_type as privilege,a.is_grantable as grantable
  from pg_proc p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
  where p.oid=to_regprocedure($1) and a.grantee<>p.proowner`,[signature])).rows;
 if(rights.length!==1||rights[0].role!=='blizhniy_payment_reconciler'||rights[0].privilege!=='EXECUTE'||rights[0].grantable!==false)throw Error('Unexpected reconciliation function access');
}

export async function assertExtendedPublicationTestSchema(tx,{specialist,inbox,enrollment=false,bookings=false,views=false,responses=false,cancellations=false,recovery=false,reconciliationAlert=false,hostedRefunds=false,undeliveredCompensation=false,marqueeRefunds=false,placementRefundProof=false,specialistRefunds=false,specialistRepeat=false,placementRenewals=false,marqueeAdmission=false,marqueeQueue=false}){
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
 if(cancellations){
  if(!specialist||!enrollment||!inbox||!bookings||!views||!responses)throw Error('Unsupported checkout cancellation deployment');
  accepted=fingerprints.checkoutCancellation;
 }
 if(recovery){
  if(!cancellations)throw Error('Unsupported reconciliation recovery deployment');
  accepted=fingerprints.reconciliationRecovery;
 }
 if(reconciliationAlert){
  if(!recovery)throw Error('Unsupported reconciliation alert deployment');
  accepted=fingerprints.reconciliationAlert;
 }
 if(hostedRefunds){
  if(!reconciliationAlert)throw Error('Unsupported hosted refund deployment');
  accepted=fingerprints.hostedRefunds;
 }
 if(undeliveredCompensation){
  if(!hostedRefunds)throw Error('Unsupported undelivered compensation deployment');
  accepted=fingerprints.hostedRefundsWithUndeliveredCompensation;
 }
 if(marqueeRefunds){
  if(!undeliveredCompensation)throw Error('Unsupported marquee refund deployment');
  accepted=fingerprints.hostedRefundsWithMarquee;
 }
 if(placementRefundProof){
  if(!marqueeRefunds)throw Error('Unsupported placement refund proof deployment');
  accepted=fingerprints.hostedRefundsWithPlacementProof;
 }
 if(specialistRefunds){
  if(!placementRefundProof)throw Error('Unsupported specialist refund deployment');
  accepted=fingerprints.hostedRefundsWithSpecialist;
 }
 if(specialistRepeat){
  if(!specialistRefunds)throw Error('Unsupported specialist repeat deployment');
  accepted=fingerprints.hostedSpecialistRepeat;
 }
 if(placementRenewals){
  if(!specialistRepeat)throw Error('Unsupported placement renewal deployment');
  accepted=fingerprints.hostedPlacementRenewals;
 }
 if(marqueeAdmission){
  if(!placementRenewals)throw Error('Unsupported marquee admission deployment');
  accepted=fingerprints.hostedMarqueeAdmission;
 }
 if(marqueeQueue){
  if(!marqueeAdmission)throw Error('Unsupported marquee queue deployment');
  accepted=fingerprints.hostedMarqueeQueue;
 }
 if(!accepted.includes(hash))throw Error('Unexpected extended publication TEST schema');
 if(marqueeQueue)await assertReconcilerFunctionAccess(tx,'app.next_hosted_marquee(text)');
 if(marqueeAdmission)await assertHostedMarqueeAdmissionAccess(tx);
 if(placementRenewals)await assertReconcilerFunctionAccess(tx,'app.apply_hosted_placement_renewal(uuid,uuid)');
 if(cancellations)await assertCheckoutCancellationAccess(tx);
 if(recovery)await assertReconciliationCommandAccess(tx);
 if(reconciliationAlert)await assertReconciliationCommandAccess(tx,true);
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
   [['check_specialist_test_dispatch','require_specialist_test_terms','guard_specialist_checkout_terms','guard_specialist_payment_fulfillment','guard_specialist_publication_window','guard_phone_wait_job','specialist_repeat_basis','guard_specialist_repeat_purchase']]);
  if(unexpected.rows.length)throw Error('Unexpected specialist TEST object access');
 }
 if(inbox){
  const extra=await tx.query(`select 1 from pg_proc p cross join lateral
   aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl
   where p.oid='app.apply_inbox_preference()'::regprocedure and acl.grantee<>p.proowner limit 1`);
  if(extra.rows.length)throw Error('Unexpected inbox function access');
 }
}
