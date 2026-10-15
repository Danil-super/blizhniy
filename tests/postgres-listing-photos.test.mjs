import assert from "node:assert/strict";
import {test} from "node:test";
import {parseListingPhotoIds} from "../src/lib/listing-photo-contract.ts";
import {ListingDraftInputError} from "../src/lib/listing-draft-contract.ts";
import {PostgresListingPhotoStore} from "./listing-photo-module.mjs";
import {ListingDraftAccessError} from "./listing-draft-module.mjs";
const owner="11111111-1111-4111-8111-111111111111",other="22222222-2222-4222-8222-222222222222",photo="33333333-3333-4333-8333-333333333333";
test("photo replacement accepts only bounded unique canonical media UUIDv4 identifiers, not paths or metadata",()=>{
  assert.deepEqual(parseListingPhotoIds([]),[]);assert.deepEqual(parseListingPhotoIds([photo.toUpperCase()]),[photo]);
  for(const value of [null,{},"",[photo,photo.toUpperCase()],["https://example.invalid/photo.webp"],[{id:photo}],
    ["33333333-3333-8333-8333-333333333333"],Array(1),Array(10001).fill(photo)])assert.throws(()=>parseListingPhotoIds(value),ListingDraftInputError);
});
test("different authenticated owner cannot read or replace photo links or query media metadata",async()=>{
  const calls=[];
  const store=new PostgresListingPhotoStore({transaction:async work=>work({query:async(sql,values)=>{
    calls.push(sql);
    if(sql.startsWith("select u.id"))return{rows:[{id:owner,role:"admin",verified:true,isBlocked:false,authVersion:"0"}],rowCount:1};
    if(sql.startsWith("select token_hash"))return{rows:[{token_hash:values[0]}],rowCount:1};
    throw new Error("Unexpected resource SQL in owner denial fixture");
  }})});
  await assert.rejects(store.read("a".repeat(64),other,photo),ListingDraftAccessError);
  await assert.rejects(store.replace("a".repeat(64),other,photo,"1",[photo]),ListingDraftAccessError);
  assert.equal(calls.some(sql=>sql.includes("app.listing")||sql.includes("app.media")),false);
});
