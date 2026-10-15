import assert from "node:assert/strict";
import {randomBytes,randomUUID} from "node:crypto";
import {createPostgresDatabase} from "../src/lib/postgres.ts";
import {hashSessionToken} from "../src/lib/identity.ts";
import {ListingDraftInputError} from "../src/lib/listing-draft-contract.ts";
import {AuthRateLimiter} from "../src/lib/auth-http.ts";
import {createProductionListingPhotoHandler} from "./listing-photo-http-module.mjs";
import {testListingForm} from './listing-form-integration.mjs';
import {PostgresListingPhotoStore} from "./listing-photo-module.mjs";
import {PostgresListingDraftStore,ListingDraftAccessError,ListingDraftConflictError} from "./listing-draft-module.mjs";
import {loadAdminModule} from "./admin-module.mjs";
const {AppSessionAccessError}=loadAdminModule("app-session-transaction");

export async function testListingPhotos(suite,operator,config,credentials){
  assert.equal(config.host,"127.0.0.1");
  const env={NODE_ENV:"test",BLIZHNIY_DB_HOST:config.host,BLIZHNIY_DB_PORT:String(config.port),BLIZHNIY_DB_NAME:config.database,
    BLIZHNIY_DB_USER:credentials.user,BLIZHNIY_DB_PASSWORD:credentials.password,BLIZHNIY_DB_SSL_MODE:"disable"};
  let db=createPostgresDatabase(env),store=new PostgresListingPhotoStore(db);
  const hash=`scrypt$131072$8$1$${"a".repeat(32)}$${"b".repeat(128)}`;
  const users=(await operator.query(`insert into app.users(email,password_hash,role,email_verified_at)
    select x.email,$1,x.role,now() from jsonb_to_recordset($2::jsonb) x(email text,role text) returning id,role,email`,
    [hash,JSON.stringify(["owner","other","admin"].map(name=>({email:`photo-${name}-${randomBytes(5).toString("hex")}@example.invalid`,role:name==="admin"?"admin":"user"})))])).rows;
  const [owner,other,admin]=["owner","other","admin"].map(name=>users.find(row=>row.email.startsWith(`photo-${name}-`)));
  const session=async(id,short=false)=>{
    const token=randomBytes(32).toString("hex");
    await operator.query(`insert into app.sessions(token_hash,user_id,auth_version,scope,expires_at)
      select $1,id,auth_version,'app',clock_timestamp()+$2::interval from app.users where id=$3`,[hashSessionToken(token),short?"0.4 seconds":"7 hours",id]);
    return token;
  };
  const token=await session(owner.id),otherToken=await session(other.id),adminToken=await session(admin.id);
  const draft=await new PostgresListingDraftStore(db).createEmpty(token,owner.id,randomUUID());
  const media=async(id,ready=true)=>{
    const row=(await operator.query(`insert into app.media_objects(owner_id,intent_id,mime_type,width,height,size,sha256)
      values($1,$2,'image/webp',2,3,12,$3) returning id`,[id,randomUUID(),"a".repeat(64)])).rows[0];
    // Synthetic DB fixture only. Real ready promotion must verify the actual private file.
    if(ready)await operator.query("update app.media_objects set state='ready',ready_at=clock_timestamp() where id=$1",[row.id]);
    return row.id;
  };
  const a=await media(owner.id),b=await media(owner.id),foreign=await media(other.id),pending=await media(owner.id,false);
  let saved;
  try{
    await suite.test("owned photo fixture grants only association operations and read-only media identity, never metadata mutation",async()=>{
      await operator.query(`grant select(listing_id,media_id,position),insert(listing_id,media_id,position),delete on app.listing_photos to blizhniy_runtime;
        grant select(id,owner_id,state,mime_type,width,height,size) on app.media_objects to blizhniy_runtime`);
      for(const sql of ["update app.listing_photos set position=0 where false","update app.media_objects set owner_id=owner_id where false",
        "update app.media_objects set state='ready' where false","select sha256 from app.media_objects limit 0"]){
        await assert.rejects(db.query(sql),{code:"42501"});
      }
    });
    await suite.test("private draft photo replacement preserves order, increments exact revision and leaves media and quota unchanged",async()=>{
      assert.deepEqual(await store.read(token,owner.id,draft.id),{id:draft.id,revision:"1",photos:[]});
      const before=(await operator.query("select charged_bytes,charged_objects from app.media_storage_budget")).rows;
      saved=await store.replace(token,owner.id,draft.id,"1",[b,a]);
      assert.equal(saved.revision,"2");assert.deepEqual(saved.photos.map(row=>row.id),[b,a]);
      assert.deepEqual(await store.read(token,owner.id,draft.id),saved);
      for(const photo of saved.photos)assert.deepEqual(Object.keys(photo).sort(),["height","id","mimeType","size","width"]);
      for(const secret of [owner.id,"sha256","ready_at","storage_path"])assert.equal(JSON.stringify(saved).includes(secret),false);
      assert.deepEqual((await operator.query("select charged_bytes,charged_objects from app.media_storage_budget")).rows,before);
      assert.equal((await new PostgresListingDraftStore(db).read(token,owner.id,draft.id)).draft.title,"");
    });
    await suite.test("foreign, pending, unknown media and another account or admin cannot alter or disclose the owned association list",async()=>{
      for(const id of [foreign,pending,randomUUID()])await assert.rejects(store.replace(token,owner.id,draft.id,saved.revision,[a,id]),ListingDraftAccessError);
      for(const [credential,user] of [[otherToken,other],[adminToken,admin]]){
        await assert.rejects(store.read(credential,user.id,draft.id),ListingDraftAccessError);
        await assert.rejects(store.replace(credential,user.id,draft.id,saved.revision,[foreign]),ListingDraftAccessError);
      }
      // Even an operator-created inconsistent link must never disclose another owner's image metadata.
      await operator.query("insert into app.listing_photos(listing_id,media_id,position) values($1,$2,2)",[draft.id,foreign]);
      try{await assert.rejects(store.read(token,owner.id,draft.id),ListingDraftAccessError);}
      finally{await operator.query("delete from app.listing_photos where listing_id=$1 and media_id=$2",[draft.id,foreign]);}
      assert.deepEqual(await store.read(token,owner.id,draft.id),saved);
    });
    await suite.test("simultaneous photo replacement has one CAS winner and invalidates stale core edits",async()=>{
      const results=await Promise.allSettled([store.replace(token,owner.id,draft.id,saved.revision,[a]),
        store.replace(await session(owner.id),owner.id,draft.id,saved.revision,[b])]);
      const winners=results.filter(row=>row.status==="fulfilled"),failures=results.filter(row=>row.status==="rejected");
      assert.equal(winners.length,1);assert.equal(failures.length,1);assert.ok(failures[0].reason instanceof ListingDraftConflictError);
      saved=winners[0].value;assert.equal(saved.revision,"3");
      await assert.rejects(new PostgresListingDraftStore(db).update(token,owner.id,draft.id,"2",{kind:"prodam",title:"stale"}),ListingDraftConflictError);
    });
    await suite.test("failure after unlink and expiry after insertion roll back the whole photo list and revision",async()=>{
      const fault=new PostgresListingPhotoStore({transaction:work=>db.transaction(tx=>work({query:async(sql,values)=>{
        const result=await tx.query(sql,values);if(sql.startsWith("delete from app.listing_photos"))throw new Error("Synthetic interrupted replacement");return result;
      }}))});
      await assert.rejects(fault.replace(token,owner.id,draft.id,saved.revision,[a,b]),/Synthetic interrupted/);
      assert.deepEqual(await store.read(token,owner.id,draft.id),saved);
      let reached=false;
      const delayed=new PostgresListingPhotoStore({transaction:work=>db.transaction(tx=>work({query:async(sql,values)=>{
        const result=await tx.query(sql,values);if(sql.startsWith("insert into app.listing_photos")){reached=true;await operator.query("select pg_sleep(0.6)");}return result;
      }}))});
      await assert.rejects(delayed.replace(await session(owner.id,true),owner.id,draft.id,saved.revision,[a,b]),AppSessionAccessError);
      assert.equal(reached,true);assert.deepEqual(await store.read(token,owner.id,draft.id),saved);
    });
    await suite.test("non-draft and revoked sessions remain denied and lost commit acknowledgement requires readback in a fresh pool",async()=>{
      await operator.query("update app.listings set status='archived' where id=$1",[draft.id]);
      await assert.rejects(store.read(token,owner.id,draft.id),ListingDraftAccessError);
      await assert.rejects(store.replace(token,owner.id,draft.id,saved.revision,[a]),ListingDraftAccessError);
      await operator.query("update app.listings set status='draft' where id=$1",[draft.id]);
      const revoked=await session(owner.id);await operator.query("delete from app.sessions where token_hash=$1",[hashSessionToken(revoked)]);
      await assert.rejects(store.read(revoked,owner.id,draft.id),AppSessionAccessError);
      let attempts=0;const unknown=new Error("Synthetic post-commit loss");
      const uncertain=new PostgresListingPhotoStore({transaction:async work=>{attempts++;await db.transaction(work);throw unknown;}});
      await assert.rejects(uncertain.replace(token,owner.id,draft.id,saved.revision,[]),error=>error===unknown);assert.equal(attempts,1);
      await db.close();db=createPostgresDatabase(env);store=new PostgresListingPhotoStore(db);
      const recovered=await store.read(token,owner.id,draft.id);assert.equal(recovered.revision,"4");assert.deepEqual(recovered.photos,[]);
    });
    await suite.test("photo association enforces the existing 160 MiB aggregate bound on server metadata without trusting client sizes",async()=>{
      const ids=(await operator.query(`insert into app.media_objects(owner_id,intent_id,mime_type,width,height,size,sha256)
        select $1,gen_random_uuid(),'image/webp',2048,2048,2097152,$2 from generate_series(1,81) returning id`,[owner.id,"b".repeat(64)])).rows.map(row=>row.id);
      await operator.query("update app.media_objects set state='ready',ready_at=clock_timestamp() where id=any($1::uuid[])",[ids]);
      const current=await store.read(token,owner.id,draft.id);
      const exact=await store.replace(token,owner.id,draft.id,current.revision,ids.slice(0,80));assert.equal(exact.photos.length,80);
      await assert.rejects(store.replace(token,owner.id,draft.id,exact.revision,ids),ListingDraftInputError);
      assert.deepEqual(await store.read(token,owner.id,draft.id),exact);
      await store.replace(token,owner.id,draft.id,exact.revision,[]);
    });
    await suite.test("photo HTTP composes real cookie authorization, shared limiter, restricted SQL and readback after an unknown write",async()=>{
      const origin="https://app.example.invalid",events=[],limiter=new AuthRateLimiter(db,"s".repeat(64));
      const handle=createProductionListingPhotoHandler({origin},()=>({store,limiter}),event=>events.push(event));
      const request=(credential,body,method="POST")=>new Request(origin+"/api/account/listing-photos",{
        method,headers:{host:new URL(origin).host,origin,"x-blizhniy-request":"1","x-real-ip":"192.0.2.44","content-type":"application/json",cookie:`__Host-blizhniy_session=${credential}`},body:JSON.stringify(body),
      });
      const body={expectedOwnerId:owner.id,listingId:draft.id};
      const initial=await store.read(token,owner.id,draft.id);
      const savedResponse=await handle(request(token,{...body,expectedRevision:initial.revision,photoIds:[b,a]},"PUT"));
      assert.equal(savedResponse.status,200);const saved=await savedResponse.json();assert.deepEqual(saved.photos.map(row=>row.id),[b,a]);
      const conflict=await handle(request(token,{...body,expectedRevision:initial.revision,photoIds:[]},"PUT"));assert.equal(conflict.status,409);
      for(const [credential,expectedOwnerId] of [[otherToken,owner.id],[otherToken,other.id],[adminToken,admin.id]]){
        const denied=await handle(request(credential,{...body,expectedOwnerId}));assert.equal(denied.status,404);assert.deepEqual(await denied.json(),{error:{code:"DRAFT_NOT_FOUND"}});
      }
      const revoked=await session(owner.id);await operator.query("delete from app.sessions where token_hash=$1",[hashSessionToken(revoked)]);
      assert.equal((await handle(request(revoked,body))).status,401);
      let attempts=0;const uncertain=new PostgresListingPhotoStore({transaction:async work=>{attempts++;await db.transaction(work);throw new Error("Synthetic lost HTTP write acknowledgement");}});
      const unknown=createProductionListingPhotoHandler({origin},()=>({store:uncertain,limiter}),event=>events.push(event));
      const failed=await unknown(request(token,{...body,expectedRevision:saved.revision,photoIds:[]},"PUT"));
      assert.equal(failed.status,503);assert.deepEqual(await failed.json(),{error:{code:"PHOTOS_UNAVAILABLE"}});assert.equal(attempts,1);
      const readback=await handle(request(token,body));assert.equal(readback.status,200);
      const recovered=await readback.json();assert.equal(BigInt(recovered.revision),BigInt(saved.revision)+1n);assert.deepEqual(recovered.photos,[]);
      for(const value of [token,owner.id,draft.id,a,b])assert.equal(JSON.stringify(events).includes(value),false);
    });
    await testListingForm(suite,operator,db,{owner,other,token,otherToken,a,foreign,pending});
    const {testListingModeration}=await import('./listing-moderation-integration.mjs');
    await testListingModeration(suite,operator,db,config,{owner,other,admin,token,otherToken,adminToken,session,a});
  }finally{await db.close();}
}
