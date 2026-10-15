import {readFileSync} from "node:fs";
import {createRequire} from "node:module";
import * as contract from "../src/lib/listing-draft-contract.ts";
import * as photos from "../src/lib/listing-photo-contract.ts";
import * as drafts from "./listing-draft-module.mjs";
import * as limits from "../src/lib/media-limits.ts";
import {loadAdminModule} from "./admin-module.mjs";
const ts=createRequire(import.meta.url)("typescript"), exports={};
new Function("require","exports",ts.transpileModule(readFileSync(new URL("../src/lib/postgres-listing-photos.ts",import.meta.url),"utf8"),{
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},
}).outputText)(name=>{
  if(name==="./listing-draft-contract")return contract;
  if(name==="./listing-photo-contract")return photos;
  if(name==="./postgres-listing-drafts")return drafts;
  if(name==="./media-limits.ts")return limits;
  if(name==="./app-session-transaction")return loadAdminModule("app-session-transaction");
  throw new Error("Unapproved listing photo fixture import");
},exports);
export const {PostgresListingPhotoStore}=exports;
