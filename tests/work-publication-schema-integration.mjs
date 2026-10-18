import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import pg from 'pg';
import {bootstrapPostgres,getBootstrapPlan} from '../scripts/bootstrap-postgres.mjs';
import {parseWorkPublicationForm} from '../src/lib/work-publication-contract.ts';

export async function testWorkPublicationSchema(suite,admin,config,credentials){
 assert.equal(config.host,'127.0.0.1');
 const target=`${config.host}:${config.database}`,before=(await admin.query('select name,sha256 from blizhniy_meta.migrations order by name')).rows;
 const limited=new pg.Client({...config,...credentials});await limited.connect();
 const owner=randomUUID(),id=randomUUID(),key=randomUUID();
 const down=readFileSync(new URL('../database/migrations/0016-work-publications.down.sql',import.meta.url),'utf8');
 try{
  await suite.test('work schema upgrades additively, preserves every earlier journal entry and can repeat without writes',async()=>{
   assert.equal((await bootstrapPostgres(admin,target,{includeWorkPublications:true})).applied,16-before.length);
   const after=(await admin.query('select name,sha256 from blizhniy_meta.migrations order by name')).rows;
   assert.deepEqual(after.slice(0,before.length),before);
   assert.deepEqual(after,getBootstrapPlan({includeWorkPublications:true}).map(({name,sha256})=>({name,sha256})));
   assert.equal((await bootstrapPostgres(admin,target,{includeWorkPublications:true})).applied,0);
   assert.equal((await admin.query('select count(*)::int as n from app.work_publications')).rows[0].n,0);
  });
  await suite.test('work migration grants no new runtime access or financial/owner authority',async()=>{
   for(const sql of ['select * from app.work_publications limit 0','select * from app.work_publication_photos limit 0',
    'update app.work_publications set is_paid=true where false','update app.work_publications set author_id=gen_random_uuid() where false',
    'delete from app.work_publications where false','truncate app.work_publications'])await assert.rejects(limited.query(sql),{code:'42501'});
  });
  await suite.test('work tables constrain kinds, payload identity, generated title, stable intent and publication dates',async()=>{
   const hash=`scrypt$131072$8$1$${'c'.repeat(32)}$${'d'.repeat(128)}`;
   await admin.query('insert into app.users(id,email,password_hash,email_verified_at) values($1,$2,$3,clock_timestamp())',[owner,`work-schema-${owner}@example.invalid`,hash]);
   const form=parseWorkPublicationForm('workRequest',{title:'Работа для мастера',description:'Техническая запись'});
   const insert='insert into app.work_publications(id,author_id,kind,creation_key,form) values($1,$2,$3,$4,$5::jsonb) returning title,revision::text';
   assert.deepEqual((await admin.query(insert,[id,owner,'workRequest',key,JSON.stringify(form)])).rows,[{title:form.title,revision:'1'}]);
   await assert.rejects(admin.query(insert,[randomUUID(),owner,'workRequest',key,JSON.stringify(form)]),{code:'23505'});
   for(const [invalid,code] of [[{...form,kind:'vacancy'},'23514'],[{...form,title:'x'.repeat(121)},'23514'],[[],'23502'],[{...form,description:'x'.repeat(66000)},'23514']]){
    await assert.rejects(admin.query(insert,[randomUUID(),owner,'workRequest',randomUUID(),JSON.stringify(invalid)]),{code});
   }
   await assert.rejects(admin.query("update app.work_publications set status='published' where id=$1",[id]),{code:'23514'});
   await assert.rejects(admin.query("update app.work_publications set published_at=now(),expires_at=now()-interval '1 day' where id=$1",[id]),{code:'23514'});
   await admin.query("update app.work_publications set revision=9007199254740993 where id=$1",[id]);
   assert.equal((await admin.query('select revision::text from app.work_publications where id=$1',[id])).rows[0].revision,'9007199254740993');
  });
  await suite.test('nonempty work rollback refuses loss; account erasure cascades, then empty rollback/reapply preserves earlier schema',async()=>{
   try{await assert.rejects(admin.query(down),/Refusing to remove nonempty work publications/);}finally{await admin.query('rollback');}
   assert.equal((await admin.query('select count(*)::int as n from app.work_publications where author_id=$1',[owner])).rows[0].n,1);
   await admin.query('delete from app.users where id=$1',[owner]);
   assert.equal((await admin.query('select count(*)::int as n from app.work_publications where author_id=$1',[owner])).rows[0].n,0);
   const prefix=(await admin.query("select name,sha256 from blizhniy_meta.migrations where name<>'0016-work-publications.sql' order by name")).rows;
   await admin.query(down);await admin.query("delete from blizhniy_meta.migrations where name='0016-work-publications.sql'");
   assert.equal((await bootstrapPostgres(admin,target,{includeWorkPublications:true})).applied,1);
   assert.deepEqual((await admin.query('select name,sha256 from blizhniy_meta.migrations order by name')).rows.slice(0,15),prefix);
  });
 }finally{await admin.query('delete from app.users where id=$1',[owner]);await limited.end();}
}
