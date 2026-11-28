// Owned synthetic browser process only. No connection, credentials or real data access.
const assert=require('node:assert/strict'),{createHash}=require('node:crypto'),pg=require('pg');
const {categories,tariffs}=require('../src/lib/data.ts');
assert.equal(process.env.BLIZHNIY_DB_PASSWORD,'synthetic-ui-db-password');
const uuid=text=>{const hex=createHash('sha256').update(text).digest('hex');return `${hex.slice(0,8)}-${hex.slice(8,12)}-4${hex.slice(13,16)}-8${hex.slice(17,20)}-${hex.slice(20,32)}`;};
const rows=categories.flatMap((root,i)=>[{id:uuid(root.slug),parent_id:null,slug:root.slug,name:root.name,sort_order:i,active:true},
 ...root.children.map((name,j)=>({id:uuid(root.slug+name),parent_id:uuid(root.slug),slug:root.slug+'-'+j,name,sort_order:j,active:true}))]);
pg.Pool=class{
 constructor(config){assert.equal(config.password,'synthetic-ui-db-password');}on(){}async end(){}
 async query(sql){
  sql=typeof sql==='string'?sql:sql.text;
  if(sql.includes('from pg_roles'))return{rows:[{name:'blizhniy_runtime',rolsuper:false,rolcreatedb:false,rolcreaterole:false,rolreplication:false,rolbypassrls:false,
   schema_create:false,public_create:false,database_create:false,temp_create:false,role_update:false,role_insert:false,identity_owner_permissions_missing:false,rate_schema_missing:false}]};
  if(process.env.BLIZHNIY_REFUND_ADMIN==='journal-test'&&sql.trimStart().startsWith('insert into app.auth_rate_limits'))return{rows:[{allowed:true}]};
  if(sql==="select to_regclass('app.marquee_test_admissions') is not null as installed")return{rows:[{installed:false}]};
  if(sql==="select to_regclass('app.listing_blocks') is not null as installed"||
     sql==="select to_regclass('app.specialist_test_enrollment') is not null as installed")return{rows:[{installed:false}]};
  if(sql==="select pg_catalog.to_regnamespace('app_publication_restriction') is not null as installed"||
     sql==="select pg_catalog.to_regnamespace('app_publication_privacy') is not null as installed")return{rows:[{installed:false}]};
  if(/from app\.categories\b/.test(sql))return{rows};
  if(/from app\.tariffs\b/.test(sql))return{rows:tariffs.map(t=>({id:uuid(t.action),action:t.action,name:t.name,price:Number(t.price).toFixed(2),duration_days:t.durationDays,active:t.active}))};
  if(sql.startsWith('select w.id,w.kind,')&&sql.includes('from app.work_publications w')&&sql.includes('join app.work_moderation review')&&sql.includes("review.state='approved'")&&sql.includes("w.status='published' and w.is_paid")&&sql.includes('w.expires_at>statement_timestamp()'))return{rows:[]};
  if(sql.startsWith('select s.id,s.kind,')&&sql.includes('from app.service_publications s')&&sql.includes('join app.service_moderation review')&&sql.includes("review.state='approved'")&&sql.includes("s.status='published' and s.is_paid")&&sql.includes('s.deleted_at is null')&&sql.includes('s.expires_at>statement_timestamp()'))return{rows:[]};
  // This general fixture has no ordinary public listings. Dedicated page tests provide their own rows.
  if(sql.startsWith('select l.id,l.author_id as "ownerId"')&&sql.includes("review.state='approved'")&&sql.includes("l.status='published' and l.is_paid")&&sql.includes('l.expires_at>clock_timestamp()'))return{rows:[]};
  if(/limit 0/i.test(sql))return{rows:[]};
  throw new Error('Unexpected browser fixture query');
 }
};
