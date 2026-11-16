import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {getBootstrapPlan} from './postgres-migration-plan.mjs';
import {getCabinetMigrationPlan} from './cabinet-release-plan.mjs';
const suffix=[
 ['0033-account-deletion.sql','8d0159c6af65c4c66aabb123695110f402fd5eac268fa2a879d97c85e628ed2f'],
 ['0034-checkout-edit-fence.sql','365cdd4a850aa67d334cff3dbed68cbfd6eff69e5c06643740bc1be02ad63df3'],
 ['0044-work-owner-actions.sql','4e3f137c8dbc2e98ceece3ca4025e64f0270467c69774bd890c20f28d5c1a04f'],
 ['0059-test-placement-guards.sql','8a9402d87aa417242f8cfb8e9200f61b15e9613e35e86de19811d8e8815c6c3c'],
];
/** Known production suffix, not the unrelated full local refund schema. No execution or credentials. */
export function getPublicationTestMigrationPlan(){
 return [...getBootstrapPlan({includeListingContactMethod:true}),...getCabinetMigrationPlan(),...suffix.map(([name,sha256])=>{
  const sql=readFileSync(new URL('../database/'+(name.startsWith('0059-')?'candidates/':'migrations/')+name,import.meta.url),'utf8');
  if(createHash('sha256').update(sql).digest('hex')!==sha256)throw Error('Publication TEST migration changed');return{name,sha256,sql};
 })];
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
