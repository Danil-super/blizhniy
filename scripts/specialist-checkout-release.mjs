import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
/** Candidate only; no installation or automatic bootstrap. */
export function getSpecialistCheckoutMigration(){
 const name='0060-local-specialist-checkout.sql',source=readFileSync(new URL('../database/candidates/'+name,import.meta.url),'utf8');
 const sha256=createHash('sha256').update(source).digest('hex');
 if(sha256!=='2b1079685ec39dbc4c67db86b6bca4aefac31682cf6892fab046fde22a59c8bd')throw Error('Invalid specialist checkout migration');
 return{name,source,sha256};
}

export const specialistCheckoutRuntimeGrants=[
 'grant select(intent_id,created_at),insert(intent_id) on app.specialist_checkout_terms to blizhniy_runtime',
];
const specialistFunctions=['specialist_checkout_ready','guard_specialist_checkout_terms','guard_specialist_checkout_edit','guard_specialist_checkout_photo',
    'guard_specialist_payment_fulfillment','apply_specialist_payment_fulfillment','guard_specialist_publication_window'];
export async function hasSpecialistCheckoutObjects(tx){
 const result=await tx.query(`select to_regclass('app.specialist_checkout_terms') is not null or exists(
  select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='app' and p.proname=any($1::text[])) as installed`,[specialistFunctions]);
 return result.rows[0].installed;
}
/** Only the new object family; existing runtime rights are checked separately. */
export async function verifySpecialistCheckoutRuntimeAccess(tx){
 const expected=new Set(['intent_id:SELECT','created_at:SELECT','intent_id:INSERT']);
 const actual=(await tx.query(`select a.attname||':'||p.privilege as key,
  has_column_privilege('blizhniy_runtime',a.attrelid,a.attnum,p.privilege||' WITH GRANT OPTION') as grantable
  from pg_attribute a cross join(values('SELECT'),('INSERT'),('UPDATE'),('REFERENCES')) p(privilege)
  where a.attrelid='app.specialist_checkout_terms'::regclass and a.attnum>0 and not a.attisdropped
   and has_column_privilege('blizhniy_runtime',a.attrelid,a.attnum,p.privilege)`)).rows;
 if(actual.length!==expected.size||actual.some(row=>row.grantable!==false||!expected.delete(row.key))||expected.size)throw Error('Invalid specialist checkout web access');
 const extra=(await tx.query(`select 1 where has_table_privilege('blizhniy_runtime','app.specialist_checkout_terms','DELETE,TRUNCATE,TRIGGER,MAINTAIN')
  or exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='app' and p.proname=any($1::text[])
   and has_function_privilege('blizhniy_runtime',p.oid,'EXECUTE'))`,[specialistFunctions])).rows;
 if(extra.length)throw Error('Invalid specialist checkout web access');
}
