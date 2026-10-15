import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import pg from "pg";
import { bootstrapPostgres, getBootstrapPlan } from "../scripts/bootstrap-postgres.mjs";

// Owned disposable loopback PG18 only; synthetic metadata is not proof of actual files.
export async function testListingPhotoSchema(suite, admin, config, credentials) {
  assert.equal(config.host,"127.0.0.1");
  const target=`${config.host}:${config.database}`;
  const prior=(await admin.query("select name,sha256 from blizhniy_meta.migrations order by name")).rows;
  const down=readFileSync(new URL("../database/migrations/0013-listing-photos.down.sql",import.meta.url),"utf8");
  const limited=new pg.Client({...config,...credentials});await limited.connect();
  try {
    await suite.test("photo associations are an explicit one-step additive upgrade with unchanged listing prefix",async()=>{
      assert.equal((await bootstrapPostgres(admin,target,{includeListingPhotos:true})).applied,1);
      const journal=(await admin.query("select name,sha256 from blizhniy_meta.migrations order by name")).rows;
      assert.deepEqual(journal.slice(0,12),prior);
      assert.deepEqual(journal,getBootstrapPlan({includeListingPhotos:true}).map(({name,sha256})=>({name,sha256})));
      assert.equal((await bootstrapPostgres(admin,target,{includeListingPhotos:true})).applied,0);
      await assert.rejects(bootstrapPostgres(admin,target,{includeListings:true}),/journal differs/);
    });
    await suite.test("empty photo-association rollback is repeatable without dropping listings or media",async()=>{
      await admin.query(down);
      assert.equal((await admin.query("select to_regclass('app.listing_photos') as relation")).rows[0].relation,null);
      await admin.query("select id from app.listings limit 0");await admin.query("select id from app.media_objects limit 0");
      await admin.query("delete from blizhniy_meta.migrations where name='0013-listing-photos.sql'");
      assert.equal((await bootstrapPostgres(admin,target,{includeListingPhotos:true})).applied,1);
    });
    await suite.test("new photo relation grants neither runtime nor PUBLIC read, link, reorder or unlink rights",async()=>{
      for(const sql of ["select listing_id,media_id,position from app.listing_photos limit 0",
        "insert into app.listing_photos(listing_id,media_id,position) select null,null,0 where false",
        "update app.listing_photos set position=0 where false","delete from app.listing_photos where false","truncate app.listing_photos"]){
        await assert.rejects(limited.query(sql),{code:"42501"});
      }
      const row=(await admin.query(`select exists(select 1 from pg_class c,
        lateral aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a
        where c.oid='app.listing_photos'::regclass and a.grantee=0) as public_access`)).rows[0];
      assert.equal(row.public_access,false);
    });
    const owner=(await admin.query("insert into app.users(email,password_hash) values($1,$2) returning id",
      [`photos-${randomBytes(8).toString("hex")}@example.invalid`,`scrypt$131072$8$1$${"a".repeat(32)}$${"b".repeat(128)}`])).rows[0].id;
    const listing=(await admin.query("insert into app.listings(author_id,listing_type) values($1,'sell') returning id",[owner])).rows[0].id;
    const photo=(await admin.query(`insert into app.media_objects(owner_id,intent_id,mime_type,width,height,size,sha256)
      values($1,$2,'image/webp',1,1,12,$3) returning id`,[owner,randomUUID(),"a".repeat(64)])).rows[0].id;
    await suite.test("photo association constraints reject dangling IDs, duplicates and invalid ordering positions",async()=>{
      const insert="insert into app.listing_photos(listing_id,media_id,position) values($1,$2,$3)";
      await assert.rejects(admin.query(insert,[randomUUID(),photo,0]),{code:"23503"});
      await assert.rejects(admin.query(insert,[listing,randomUUID(),0]),{code:"23503"});
      for(const position of [-1,10000]) await assert.rejects(admin.query(insert,[listing,photo,position]),{code:"23514"});
      await admin.query(insert,[listing,photo,0]);
      await assert.rejects(admin.query(insert,[listing,photo,1]),{code:"23505"});
      await assert.rejects(admin.query(insert,[listing,photo,0]),{code:"23505"});
      assert.deepEqual((await admin.query("select listing_id,media_id,position from app.listing_photos where listing_id=$1",[listing])).rows,
        [{listing_id:listing,media_id:photo,position:0}]);
    });
    await suite.test("nonempty photo rollback refuses data loss; listing removal unlinks but never deletes metadata or releases quota",async()=>{
      const budget=(await admin.query("select charged_bytes,charged_objects from app.media_storage_budget")).rows;
      const journal=(await admin.query("select name,sha256 from blizhniy_meta.migrations order by name")).rows;
      try{await assert.rejects(admin.query(down),/Refusing to remove nonempty listing photos/);}finally{await admin.query("rollback");}
      assert.deepEqual((await admin.query("select name,sha256 from blizhniy_meta.migrations order by name")).rows,journal);
      assert.equal((await admin.query("select count(*)::int as n from app.listing_photos where listing_id=$1",[listing])).rows[0].n,1);
      await admin.query("delete from app.listings where id=$1",[listing]);
      assert.equal((await admin.query("select count(*)::int as n from app.listing_photos where listing_id=$1",[listing])).rows[0].n,0);
      assert.equal((await admin.query("select count(*)::int as n from app.media_objects where id=$1",[photo])).rows[0].n,1);
      assert.deepEqual((await admin.query("select charged_bytes,charged_objects from app.media_storage_budget")).rows,budget);
    });
  }finally{await limited.end();}
}
