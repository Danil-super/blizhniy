import {readFileSync} from "node:fs";
import {createRequire} from "node:module";
import * as boundary from "../src/lib/auth-http.ts";
import * as cookies from "../src/lib/account-cookie.ts";
import * as proxy from "../src/lib/trusted-proxy-ip.ts";
import * as contract from "../src/lib/listing-draft-contract.ts";
import * as photos from "../src/lib/listing-photo-contract.ts";
import * as drafts from "./listing-draft-module.mjs";
import {loadAdminModule} from "./admin-module.mjs";
const require=createRequire(import.meta.url),ts=require("typescript"),exports={};
new Function("require","exports",ts.transpileModule(readFileSync(new URL("../src/lib/production-listing-photo-http.ts",import.meta.url),"utf8"),{
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},
}).outputText)(name=>{
  if(name==="node:crypto")return require(name);
  if(name==="./auth-http")return boundary;
  if(name==="./account-cookie")return cookies;
  if(name==="./trusted-proxy-ip")return proxy;
  if(name==="./listing-draft-contract")return contract;
  if(name==="./listing-photo-contract")return photos;
  if(name==="./postgres-listing-drafts")return drafts;
  if(name==="./app-session-transaction")return loadAdminModule("app-session-transaction");
  throw new Error("Unapproved photo HTTP fixture import");
},exports);
export const {createProductionListingPhotoHandler}=exports;
export function loadPhotoRoute(handleProductionListingPhotoRequest){
  const route={};
  new Function("require","exports",ts.transpileModule(readFileSync(new URL("../src/app/api/account/listing-photos/route.ts",import.meta.url),"utf8"),{
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},
  }).outputText)(name=>{
    if(name==="@/lib/auth-http")return boundary;
    if(name==="@/lib/production-listing-photo-runtime")return{handleProductionListingPhotoRequest};
    throw new Error("Unapproved photo route fixture import");
  },route);
  return route;
}
