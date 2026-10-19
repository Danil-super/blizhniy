import assert from 'node:assert/strict';import {test} from 'node:test';import {readFileSync} from 'node:fs';import {createRequire} from 'node:module';import vm from 'node:vm';
const require=createRequire(import.meta.url),ts=require('typescript'),jsx=require('react/jsx-runtime'),id='10000000-0000-4000-8000-000000000001';
test('primary public listing page never asks the old booking store for availability before rendering the new calculator',async()=>{
 const source=readFileSync(new URL('../src/app/obyavlenie/[slug]/page.tsx',import.meta.url),'utf8'),code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 for(const primary of [true,false]){let reads=0;const exports={},row={id,booking:{mode:'stay'}};
  vm.runInNewContext(code,{exports,process:{env:primary?{BLIZHNIY_AUTH_MODE:'postgres'}:{}},require:name=>{
   if(name==='react/jsx-runtime')return jsx;
   if(name==='@/components/listings/ListingPages')return{ListingDetailPage:'detail',toDemoListing:value=>value};
   if(name==='@/lib/listing-store')return{getStoredListingById:async()=>row};
   if(name==='@/lib/booking-store')return{listBookingAvailabilityForListing:async()=>{reads++;return['legacy'];}};
   if(name==='@/lib/runtime-mode')return{shouldShowFallbackContent:()=>false};throw Error('Unexpected page dependency');
  }});
  const page=await exports.default({params:Promise.resolve({slug:id})});assert.equal(reads,primary?0:1);assert.deepEqual(JSON.parse(JSON.stringify(page.props.bookingRequests)),primary?[]:['legacy']);
 }
});
test('calculator dispatcher never mounts legacy hooks for a primary login, unavailable auth state or anonymous visitor',()=>{
 const source=readFileSync(new URL('../src/components/listings/BookingCalculator.tsx',import.meta.url),'utf8'),ast=ts.createSourceFile('calculator.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX),fn=ast.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='BookingCalculator');assert.ok(fn);
 const code=ts.transpileModule(fn.getText(ast),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 for(const auth of [null,{state:'signed-in',userId:id},{state:'unavailable',userId:null},{state:'signed-out',userId:null}]){const exports={};vm.runInNewContext(code,{exports,usePrimaryAccountAuth:()=>auth,PrimaryBookingCalculator:'primary',LegacyBookingCalculator:'legacy',BookingCalendar:'calendar',require:name=>{assert.equal(name,'react/jsx-runtime');return jsx;}});
  const result=exports.BookingCalculator({booking:{mode:'stay'},listingId:id});assert.equal(result.type,auth?'primary':'legacy');
 }
});
