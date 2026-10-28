// Existing owned local database only. No fixtures, DDL, grants, provider calls or writes.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import pg from 'pg';
import {stateFile,localPrimaryDatabaseConfig,docker} from './local-primary-fixture.mjs';
import {readLocalPrimaryState,validateLocalPrimaryContainer} from './local-primary-config.mjs';

const state=readLocalPrimaryState(stateFile,process.cwd());
validateLocalPrimaryContainer(JSON.parse(await docker(['inspect',state.containerId]))[0],state);
Object.assign(process.env,{NODE_ENV:'test',BLIZHNIY_LOCAL_PRIMARY:'enabled',BLIZHNIY_LOCAL_PRIMARY_ORIGIN:state.origin,BLIZHNIY_LISTING_WORKFLOW:'postmoderation'});
const load=createRequire(import.meta.url)('./local-primary-modules.cjs').loadLocalPrimaryModule;
const db=new pg.Client(localPrimaryDatabaseConfig(state));
await db.connect();
try{
 await db.query('begin isolation level repeatable read read only');
 const listings=new(load('postgres-public-listings').PostgresPublicListingStore)(db,{postmoderation:true});
 const work=new(load('postgres-public-work').PostgresPublicWorkStore)(db,{vacancyPostmoderation:true});
 const service=new(load('postgres-public-service').PostgresPublicServiceStore)(db,{specialistProfileIdentity:true});
 const sources=[
  {kind:'listing',page:offset=>listings.sitemapPage(2,offset),read:id=>listings.read(id)},
  {kind:'vacancy',page:offset=>work.sitemapPage('vacancy',2,offset),read:id=>work.read('vacancy',id)},
  {kind:'workRequest',page:offset=>work.sitemapPage('workRequest',2,offset),read:id=>work.read('workRequest',id)},
  {kind:'specialist',page:offset=>service.sitemapPage(2,offset),read:id=>service.read('specialist',id)},
 ];
 const counts={};
 for(const source of sources){
  const ids=new Set();
  for(let offset=0;;offset+=2){
   assert.ok(offset<50000,'Unexpected local dataset size');
   const page=await source.page(offset);
   for(const entry of page.entries){
    assert.deepEqual(Object.keys(entry).sort(),['id','publishedAt']);
    assert.ok(Number.isFinite(Date.parse(entry.publishedAt)));
    assert.ok(!ids.has(entry.id),'Duplicate sitemap entry');ids.add(entry.id);
    const item=await source.read(entry.id);
    assert.equal(item?.id,entry.id,'Sitemap entry must pass the actual public detail gate');
   }
   if(!page.hasMore)break;
  }
  counts[source.kind]=ids.size;
 }
 await db.query('rollback');
 console.log(JSON.stringify({status:'passed',readOnly:true,publicEntries:counts,productionTouched:false}));
}finally{await db.end();}
