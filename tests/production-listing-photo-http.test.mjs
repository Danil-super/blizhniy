import assert from "node:assert/strict";
import {test} from "node:test";
import {createProductionListingPhotoHandler,loadPhotoRoute} from "./listing-photo-http-module.mjs";
import {ListingDraftAccessError,ListingDraftConflictError} from "./listing-draft-module.mjs";
const owner="11111111-1111-4111-8111-111111111111",id="22222222-2222-4222-8222-222222222222",photo="33333333-3333-4333-8333-333333333333";
const token="a".repeat(64),origin="https://app.example.invalid";
function fixture(failure,allowed=true){
  const calls=[],audit=[],result={id,revision:"9007199254740993",photos:[]};
  const handle=createProductionListingPhotoHandler({origin},()=>({store:{
    read:async(...args)=>{calls.push(["read",...args]);if(failure)throw failure;return result;},
    replace:async(...args)=>{calls.push(["replace",...args]);if(failure)throw failure;return result;},
  },limiter:{allowProduction:async(...args)=>{calls.push(["limit",...args]);return allowed;}}}),event=>audit.push(event));
  const request=(method="POST",extra={},headers={},query="")=>new Request(origin+"/api/account/listing-photos"+query,{
    method,headers:{host:new URL(origin).host,origin,"x-blizhniy-request":"1","x-real-ip":"192.0.2.3","content-type":"application/json",cookie:`__Host-blizhniy_session=${token}`,...headers},
    body:JSON.stringify({expectedOwnerId:owner,listingId:id,...(method==="PUT"?{expectedRevision:"9007199254740993",photoIds:[photo]}:{}),...extra}),
  });
  return{handle,request,calls,audit,result};
}
test("private photo HTTP delegates narrow IDs with exact revision and cookie authority; audit excludes private values",async()=>{
  const f=fixture();
  for(const method of ["POST","PUT"]){
    const response=await f.handle(f.request(method));assert.equal(response.status,200);assert.deepEqual(await response.json(),f.result);
    assert.equal(response.headers.get("cache-control"),"no-store");assert.equal(response.headers.get("referrer-policy"),"no-referrer");
  }
  assert.deepEqual(f.calls,[["limit","session","192.0.2.3"],["read",token,owner,id],
    ["limit","session","192.0.2.3"],["replace",token,owner,id,"9007199254740993",[photo]]]);
  for(const value of [owner,id,photo,token])assert.equal(JSON.stringify(f.audit).includes(value),false);
});
test("photo HTTP cannot reach the repository after the shared session budget refuses the request",async()=>{
  const f=fixture(undefined,false),response=await f.handle(f.request("PUT"));
  assert.equal(response.status,429);assert.equal(response.headers.get("retry-after"),"900");
  assert.deepEqual(await response.json(),{error:{code:"RATE_LIMITED"}});assert.deepEqual(f.calls,[["limit","session","192.0.2.3"]]);
});
test("both photo operations reject missing or duplicate cookies, untrusted fetch context and missing ingress",async()=>{
  for(const method of ["POST","PUT"]){
    for(const [headers,status] of [[{cookie:"",authorization:`Bearer ${token}`},401],
      [{cookie:`__Host-blizhniy_session=${token}; __Host-blizhniy_session=${token}`},401],
      [{"sec-fetch-site":"cross-site"},403],[{"x-blizhniy-request":""},403],[{"x-real-ip":""},403]]){
      const f=fixture(),response=await f.handle(f.request(method,{},headers));assert.equal(response.status,status);assert.deepEqual(f.calls,[]);
    }
  }
});
test("photo HTTP rejects forged identity/billing/metadata, invalid authority, query, body limits and cross-site requests before storage",async()=>{
  for(const [method,extra,headers,query,status] of [["PUT",{paid:true},{},"",422],["PUT",{photoIds:[photo,photo]},{},"",422],
    ["PUT",{photoIds:[{id:photo,state:"ready"}]},{},"",422],["PUT",{}, {"content-length":"65537"},"",413],
    ["POST",{}, {"content-length":"4097"},"",413],["POST",{}, {cookie:"",authorization:`Bearer ${token}`},"",401],
    ["POST",{}, {origin:"https://attacker.invalid"},"",403],["POST",{}, {"x-real-ip":""},"",403],["POST",{},{},"?id=forbidden",400]]){
    const f=fixture(),response=await f.handle(f.request(method,extra,headers,query));assert.equal(response.status,status);assert.deepEqual(f.calls,[]);
  }
});
test("photo HTTP uses generic ownership/conflict/unavailable errors without retrying or leaking a cause",async()=>{
  for(const [error,status,code] of [[new ListingDraftAccessError(),404,"DRAFT_NOT_FOUND"],[new ListingDraftConflictError(),409,"DRAFT_CHANGED"],
    [new Error("synthetic-private-path-and-SQL"),503,"PHOTOS_UNAVAILABLE"]]){
    const f=fixture(error),response=await f.handle(f.request("PUT"));assert.equal(response.status,status);assert.deepEqual(await response.json(),{error:{code}});
    assert.equal(f.calls.filter(row=>row[0]==="replace").length,1);assert.equal(JSON.stringify(f.audit).includes("synthetic-private"),false);
  }
});
test("photo Next route remains closed outside explicit PostgreSQL mode",async()=>{
  const before=process.env.BLIZHNIY_AUTH_MODE,calls=[];
  try{
    const route=loadPhotoRoute(async request=>{calls.push(request.method);return new Response(null,{status:200});});
    for(const mode of [undefined,"local","unknown"]){if(mode===undefined)delete process.env.BLIZHNIY_AUTH_MODE;else process.env.BLIZHNIY_AUTH_MODE=mode;
      for(const method of ["POST","PUT"])assert.equal((await route[method](new Request(origin,{method}))).status,404);
    }
    assert.deepEqual(calls,[]);process.env.BLIZHNIY_AUTH_MODE="postgres";
    for(const method of ["POST","PUT"])assert.equal((await route[method](new Request(origin,{method}))).status,200);
    assert.deepEqual(calls,["POST","PUT"]);assert.equal(route.GET().status,405);assert.equal(route.GET().headers.get("allow"),"POST, PUT");
  }finally{if(before===undefined)delete process.env.BLIZHNIY_AUTH_MODE;else process.env.BLIZHNIY_AUTH_MODE=before;}
});
