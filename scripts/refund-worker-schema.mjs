import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';


// One catalog snapshot; no table data, object OIDs, physical layout or owner names.
export async function readRefundSchema(tx,{namespace='app'}={}){
 if(!['app','app_admin','app_stats','app_response'].includes(namespace))throw Error('Invalid catalog namespace');
 await tx.query(`select set_config('search_path','pg_catalog',true),set_config('IntervalStyle','postgres',true),
  set_config('DateStyle','ISO, YMD',true),set_config('TimeZone','UTC',true),
  set_config('standard_conforming_strings','on',true),set_config('quote_all_identifiers','off',true),set_config('extra_float_digits','3',true)`);
 const rows=(await tx.query(`with objects as (
  select 'relation' as kind,c.relname::text as name,jsonb_build_array(c.relkind,c.relpersistence,c.relrowsecurity,c.relforcerowsecurity,
   c.relreplident,c.reloptions,c.relowner=n.nspowner,am.amname) as definition
  from pg_class c join pg_namespace n on n.oid=c.relnamespace left join pg_am am on am.oid=c.relam where n.nspname=$1::text
  union all
  select 'column',c.relname||'.'||a.attname,jsonb_build_array(a.attnum,format_type(a.atttypid,a.atttypmod),
   a.attnotnull,a.attidentity,a.attgenerated,pg_get_expr(d.adbin,d.adrelid,false),
   case when a.attcollation=0 then null else a.attcollation::regcollation::text end)
  from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace
   left join pg_attrdef d on d.adrelid=c.oid and d.adnum=a.attnum
  where n.nspname=$1::text and a.attnum>0 and not a.attisdropped
  union all
  select 'function',p.oid::regprocedure::text,jsonb_build_array(pg_get_functiondef(p.oid),p.proowner=n.nspowner)
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname=$1::text
  union all
  select 'constraint',c.conrelid::regclass::text||'.'||c.conname,
   jsonb_build_array(pg_get_constraintdef(c.oid,false),c.convalidated,c.conenforced,c.conislocal,c.connoinherit)
  from pg_constraint c join pg_namespace n on n.oid=c.connamespace where n.nspname=$1::text
  union all
  select 'external_foreign_key',c.conrelid::regclass::text||'.'||c.conname,
   jsonb_build_array(pg_get_constraintdef(c.oid,false),c.convalidated,c.conenforced,c.conislocal,c.connoinherit)
  from pg_constraint c join pg_namespace n on n.oid=c.connamespace
   join pg_class target on target.oid=c.confrelid join pg_namespace tn on tn.oid=target.relnamespace
  where c.contype='f' and n.nspname<>$1::text and tn.nspname=$1::text
  union all
  select 'policy',p.polrelid::regclass::text||'.'||p.polname,
   jsonb_build_array(p.polcmd,p.polpermissive,
    (select jsonb_agg(case when r=0 then 'PUBLIC' else r::regrole::text end order by case when r=0 then 'PUBLIC' else r::regrole::text end collate "C") from unnest(p.polroles) r),
    pg_get_expr(p.polqual,p.polrelid,false),pg_get_expr(p.polwithcheck,p.polrelid,false))
  from pg_policy p join pg_class c on c.oid=p.polrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname=$1::text
  union all
  select 'trigger',t.tgrelid::regclass::text||'.'||case when t.tgisinternal
    then c.conname||'.'||t.tgfoid::regprocedure::text else t.tgname::text end,
   jsonb_build_array(case when not t.tgisinternal then pg_get_triggerdef(t.oid,false) end,
    t.tgenabled,t.tgtype,t.tgdeferrable,t.tginitdeferred,t.tgisinternal)
  from pg_trigger t join pg_class r on r.oid=t.tgrelid join pg_namespace n on n.oid=r.relnamespace
   left join pg_constraint c on c.oid=t.tgconstraint where n.nspname=$1::text
  union all
  select 'index',i.indexrelid::regclass::text,jsonb_build_array(pg_get_indexdef(i.indexrelid,0,false),
   i.indisvalid,i.indisready,i.indislive,i.indisreplident)
  from pg_index i join pg_class c on c.oid=i.indrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname=$1::text
  union all
  select 'rule',r.ev_class::regclass::text||'.'||r.rulename,jsonb_build_array(pg_get_ruledef(r.oid,false),r.ev_enabled)
  from pg_rewrite r join pg_class c on c.oid=r.ev_class join pg_namespace n on n.oid=c.relnamespace where n.nspname=$1::text
  union all
  select 'type',t.typname,jsonb_build_array(t.typtype,t.typcategory,t.typnotnull,t.typdefault,
   t.typowner=n.nspowner,case when t.typelem<>0 then format_type(t.typelem,null) end,
   case when t.typbasetype<>0 then format_type(t.typbasetype,t.typtypmod) end,
   (select jsonb_agg(e.enumlabel order by e.enumsortorder) from pg_enum e where e.enumtypid=t.oid))
  from pg_type t join pg_namespace n on n.oid=t.typnamespace where n.nspname=$1::text
  union all
  select 'inheritance',i.inhrelid::regclass::text||'.'||i.inhseqno,
   jsonb_build_array(i.inhparent::regclass::text,i.inhdetachpending)
  from pg_inherits i join pg_class c on c.oid=i.inhrelid join pg_namespace n on n.oid=c.relnamespace
   join pg_class parent on parent.oid=i.inhparent join pg_namespace pn on pn.oid=parent.relnamespace
  where n.nspname=$1::text or pn.nspname=$1::text
  union all
  select 'sequence',s.seqrelid::regclass::text,
   jsonb_build_array(format_type(s.seqtypid,null),s.seqstart,s.seqincrement,s.seqmax,s.seqmin,s.seqcache,s.seqcycle)
  from pg_sequence s join pg_class c on c.oid=s.seqrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname=$1::text
  union all
  select 'unsupported',$1::text,jsonb_build_array(
   (select count(*) from pg_operator where oprnamespace=$1::text::regnamespace),
   (select count(*) from pg_collation where collnamespace=$1::text::regnamespace),
   (select count(*) from pg_opclass where opcnamespace=$1::text::regnamespace),
   (select count(*) from pg_opfamily where opfnamespace=$1::text::regnamespace),
   (select count(*) from pg_conversion where connamespace=$1::text::regnamespace),
   (select count(*) from pg_ts_config where cfgnamespace=$1::text::regnamespace),
   (select count(*) from pg_ts_dict where dictnamespace=$1::text::regnamespace),
   (select count(*) from pg_ts_parser where prsnamespace=$1::text::regnamespace),
   (select count(*) from pg_ts_template where tmplnamespace=$1::text::regnamespace),
   (select count(*) from pg_extension where extnamespace=$1::text::regnamespace),
   (select count(*) from pg_cast c join pg_type s on s.oid=c.castsource join pg_type t on t.oid=c.casttarget
    where s.typnamespace=$1::text::regnamespace or t.typnamespace=$1::text::regnamespace),
   (select count(*) from pg_statistic_ext s join pg_class c on c.oid=s.stxrelid
    where s.stxnamespace=$1::text::regnamespace or c.relnamespace=$1::text::regnamespace),
   (select count(*) from pg_policy p join pg_class c on c.oid=p.polrelid where c.relnamespace=$1::text::regnamespace))
 ) select kind,name,definition from objects order by kind collate "C",name collate "C",definition::text collate "C" limit 10001`,[namespace])).rows;
 if(rows.length===0||rows.length>10000)throw Error('Invalid refund schema size');
 const groups={};
 for(const {kind,name,definition} of rows)(groups[kind]??=[]).push([name,definition]);
 return Object.fromEntries(Object.entries(groups).map(([kind,items])=>[kind,{count:items.length,sha256:createHash('sha256').update(JSON.stringify(items)).digest('hex')}]));
}

export async function assertRefundSchema(tx,schema=54,{localPrimary=false}={}){
 if(![54,55,56,57,58,60].includes(schema)||typeof localPrimary!=='boolean'||(localPrimary&&schema<55)||([58,60].includes(schema)&&!localPrimary))throw Error('Invalid refund schema version');
 const expected=JSON.parse(readFileSync(new URL(localPrimary?`../database/refund-schema-local-primary-00${schema}.json`:`../database/refund-schema-00${schema}.json`,import.meta.url),'utf8'));
 if(JSON.stringify(await readRefundSchema(tx))!==JSON.stringify(expected))throw Error('Invalid refund schema');
}
