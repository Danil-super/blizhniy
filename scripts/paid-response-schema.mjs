import {createHash} from 'node:crypto';
import {readRefundSchema} from './refund-worker-schema.mjs';

export async function assertPaidResponseSchema(tx){
 const shape=await readRefundSchema(tx,{namespace:'app_response'});
 if(createHash('sha256').update(JSON.stringify(shape)).digest('hex')!=='57f5775ea39ba4272b07515a7d74c8728d79b4d0430b2a079d4227289696ad50')throw Error('Unexpected response schema');
 const {rows:[access]}=await tx.query(`with ns as (
  select oid,nspowner,nspacl from pg_namespace where nspname='app_response'
 ), objects(name,owner,acl) as (
  select 'namespace',nspowner,coalesce(nspacl,acldefault('n',nspowner)) from ns
  union all select relname,relowner,coalesce(relacl,acldefault('r',relowner)) from pg_class join ns on relnamespace=ns.oid
  union all select relname||'.'||attname,relowner,attacl from pg_attribute join pg_class on attrelid=pg_class.oid join ns on relnamespace=ns.oid
  union all select proname,proowner,coalesce(proacl,acldefault('f',proowner)) from pg_proc join ns on pronamespace=ns.oid
  union all select proname,proowner,coalesce(proacl,acldefault('f',proowner)) from pg_proc where pronamespace='app'::regnamespace
   and proname in ('require_resolved_response_checkout','guard_response_target_edit','guard_response_photo_edit','guard_response_selection')
 ) select nspowner=(select nspowner from pg_namespace where nspname='app') as same_owner,
 not exists(select 1 from pg_default_acl where defaclnamespace=ns.oid) as clean_defaults,
 array(select concat_ws(':',name,grantee::regrole::text,privilege_type,grantor=owner,is_grantable)
  from objects cross join lateral aclexplode(acl) where grantee<>owner order by 1) as grants from ns`);
 const expected=[];
 for(const role of ['blizhniy_payment_reconciler','blizhniy_runtime']){
  expected.push('namespace:'+role+':USAGE:t:f');
  for(const col of ['intent_id','applicant_id','shop_id'])expected.push('admissions.'+col+':'+role+':SELECT:t:f');
  const functions=role==='blizhniy_runtime'?['admit','authorized_for_dispatch','read_delivery','can_prepare']:['deliver'];
  for(const name of functions)expected.push(name+':'+role+':EXECUTE:t:f');
 }
 if(!access?.same_owner||!access.clean_defaults||JSON.stringify(access.grants.sort())!==JSON.stringify(expected.sort()))throw Error('Unexpected response grants');
}
