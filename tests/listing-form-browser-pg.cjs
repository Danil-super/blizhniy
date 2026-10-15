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
  if(/from app\.categories\b/.test(sql))return{rows};
  if(/from app\.tariffs\b/.test(sql))return{rows:tariffs.map(t=>({id:uuid(t.action),action:t.action,name:t.name,price:Number(t.price).toFixed(2),duration_days:t.durationDays,active:t.active}))};
  if(/limit 0/i.test(sql))return{rows:[]};
  throw new Error('Unexpected browser fixture query');
 }
};
