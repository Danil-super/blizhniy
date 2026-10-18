import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';import {readFileSync} from 'node:fs';import pg from 'pg';
import {bootstrapPostgres,getBootstrapPlan} from '../scripts/bootstrap-postgres.mjs';
import {parseServicePublicationForm} from '../src/lib/service-publication-contract.ts';
export async function testServicePublicationSchema(suite,admin,config,credentials){
 assert.equal(config.host,'127.0.0.1');const target=`${config.host}:${config.database}`,before=(await admin.query('select name,sha256 from blizhniy_meta.migrations order by name')).rows;
 const limited=new pg.Client({...config,...credentials});await limited.connect();const owner=randomUUID(),key=randomUUID(),ids=[];
 const down=readFileSync(new URL('../database/migrations/0017-service-publications.down.sql',import.meta.url),'utf8');
 try{
  await suite.test('service schema expands only the explicitly requested plan and preserves the full work/auth prefix',async()=>{
   assert.equal(before.length,16);assert.equal((await bootstrapPostgres(admin,target,{includeServicePublications:true})).applied,1);
   const after=(await admin.query('select name,sha256 from blizhniy_meta.migrations order by name')).rows;
   assert.deepEqual(after.slice(0,16),before);assert.deepEqual(after,getBootstrapPlan({includeServicePublications:true}).map(({name,sha256})=>({name,sha256})));
   assert.equal((await bootstrapPostgres(admin,target,{includeServicePublications:true})).applied,0);
  });
  await suite.test('new service tables are private, unpaid by default and unavailable to runtime before explicit grant approval',async()=>{
   for(const table of ['service_publications','service_publication_photos','service_moderation']){
    await assert.rejects(limited.query(`select * from app.${table} limit 0`),{code:'42501'});
    const publicAcl=(await admin.query("select exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace cross join lateral aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a where n.nspname='app' and c.relname=$1 and a.grantee=0) as exposed",[table])).rows[0];
    assert.equal(publicAcl.exposed,false);
   }
   const hash=`scrypt$131072$8$1$${'c'.repeat(32)}$${'d'.repeat(128)}`;
   await admin.query('insert into app.users(id,email,password_hash,email_verified_at) values($1,$2,$3,clock_timestamp())',[owner,`service-schema-${owner}@example.invalid`,hash]);
   for(const kind of ['specialist','fair','marquee']){
    const form=parseServicePublicationForm(kind,{title:'Техническая запись'});
    const row=(await admin.query('insert into app.service_publications(author_id,kind,creation_key,form) values($1,$2,$3,$4::jsonb) returning id,title,status,is_paid,revision::text,published_at,expires_at',[owner,kind,key,JSON.stringify(form)])).rows[0];
    assert.equal(row.status,'draft');assert.equal(row.is_paid,false);assert.equal(row.revision,'1');assert.equal(row.published_at,null);assert.equal(row.expires_at,null);ids.push(row.id);
   }
  });
  await suite.test('service identity, single specialist, form kinds, finite public windows and exact revisions are enforced by SQL',async()=>{
   const insert='insert into app.service_publications(author_id,kind,creation_key,form) values($1,$2,$3,$4::jsonb)';
   await assert.rejects(admin.query(insert,[owner,'specialist',randomUUID(),JSON.stringify(parseServicePublicationForm('specialist',{}))]),{code:'23505'});
   await assert.rejects(admin.query(insert,[owner,'fair',key,JSON.stringify(parseServicePublicationForm('fair',{}))]),{code:'23505'});
   for(const form of [{kind:'marquee',title:'x'.repeat(141)},{kind:'wrong',title:'Bad'},{kind:'fair',title:42},{kind:'fair',title:'Good',description:'x'.repeat(66000)}]){
    await assert.rejects(admin.query(insert,[owner,form.kind==='marquee'?'marquee':'fair',randomUUID(),JSON.stringify(form)]));
   }
   for(const sql of ["status='published'","published_at=now(),expires_at=now()-interval '1 day'","updated_at='infinity'::timestamptz","revision=0"])
    await assert.rejects(admin.query(`update app.service_publications set ${sql} where id=$1`,[ids[0]]),{code:'23514'});
   await admin.query('update app.service_publications set revision=9007199254740993 where id=$1',[ids[0]]);
   assert.equal((await admin.query('select revision::text from app.service_publications where id=$1',[ids[0]])).rows[0].revision,'9007199254740993');
   await assert.rejects(admin.query("insert into app.service_moderation(publication_id,revision,state) values($1,1,'approved')",[ids[0]]),{code:'23514'});
   await assert.rejects(admin.query('insert into app.service_publication_photos(publication_id,media_id,position) values($1,gen_random_uuid(),0)',[ids[0]]),{code:'23503'});
  });
  await suite.test('service rollback refuses nonempty forms and preserves the earlier sixteen migrations during empty removal/reapply',async()=>{
   try{await assert.rejects(admin.query(down),/Refusing to remove nonempty service publications/);}finally{await admin.query('rollback');}
   assert.equal((await admin.query('select count(*)::int as n from app.service_publications where author_id=$1',[owner])).rows[0].n,3);
   await admin.query('delete from app.users where id=$1',[owner]);await admin.query(down);
   await admin.query("delete from blizhniy_meta.migrations where name='0017-service-publications.sql'");
   assert.deepEqual((await admin.query('select name,sha256 from blizhniy_meta.migrations order by name')).rows,before);
   assert.equal((await bootstrapPostgres(admin,target,{includeServicePublications:true})).applied,1);
  });
 }finally{await admin.query('delete from app.users where id=$1',[owner]);await limited.end();}
}
