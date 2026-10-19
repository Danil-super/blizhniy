import assert from 'node:assert/strict';import {test} from 'node:test';import {readFileSync} from 'node:fs';import {createRequire} from 'node:module';import vm from 'node:vm';
const ts=createRequire(import.meta.url)('typescript'),id='11111111-1111-4111-8111-111111111111';
function fixture({failed=false,sellerPages=false}={}){
 const source=readFileSync(new URL('../src/lib/listing-store.ts',import.meta.url),'utf8');
 const pick=(start,end)=>{const from=source.indexOf(start),to=source.indexOf(end,from+start.length);assert.ok(from>=0&&to>from);return source.slice(from,to);};
 const selected=pick('export async function getStoredListingById(','export async function getStoredListingForUser(')+pick('export async function listStoredListings(','export async function listStoredListingsForAdmin(');
 const calls=[],exports={},item={id,title:'Синтетическое объявление'};let legacy=0;
 const store={read:async value=>{calls.push(['read',value]);if(failed)throw Error('Synthetic primary unavailable');return item;},list:async options=>{
  calls.push(['list',options]);if(failed)throw Error('Synthetic primary unavailable');return sellerPages&&options.ownerId&&options.offset===0?Array(200).fill(item):[item];}};
 const code=ts.transpileModule(selected,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 vm.runInNewContext(code,{exports,process:{env:{BLIZHNIY_AUTH_MODE:'postgres'}},console:{error(){}},Date,Math,Number,encodeURIComponent,
  isSupabaseRestConfigured:()=>{legacy++;return true;},isUuid:value=>value===id,supabaseRest:async()=>{throw Error('Forbidden legacy request');},fetchListingRows:async()=>{throw Error('Forbidden legacy request');},
  require:path=>{assert.equal(path,'./production-public-listing-runtime');return{getProductionPublicListingStore:async()=>store};},
 });
 return{...exports,calls,item,get legacy(){return legacy;}};
}
const plain=value=>JSON.parse(JSON.stringify(value));
test('ordinary public detail/list use the primary repository before any leftover legacy configuration; unscoped private reads are not anonymous credentials',async()=>{
 const f=fixture();assert.deepEqual(await f.getStoredListingById(id,{publicOnly:true}),f.item);assert.equal(await f.getStoredListingById(id),undefined);
 assert.deepEqual(await f.listStoredListings(25,{kind:'arenda',offset:24}),[f.item]);assert.deepEqual(plain(f.calls),[['read',id],['list',{limit:25,kind:'arenda',offset:24}]]);assert.equal(f.legacy,0);
});
test('ordinary public category filtering ignores caller-supplied category IDs and keeps the real root/child name scope and one extra pagination row',async()=>{
 const f=fixture();assert.deepEqual(await f.listStoredListingsForCategory('sad-i-rasteniya',{resolvedCategory:{id:'forged-root',children:[]},subcategoryName:'Саженцы',page:2,pageSize:24}),[f.item]);
 assert.deepEqual(plain(f.calls),[['list',{categorySlug:'sad-i-rasteniya',subcategoryName:'Саженцы',limit:25,offset:24}]]);assert.equal(f.legacy,0);
});
test('seller public listing adapter preserves all existing rows in bounded pages and does not load another account or legacy backend',async()=>{
 const f=fixture({sellerPages:true});assert.equal((await f.listStoredListingsForSeller(id)).length,201);assert.deepEqual(plain(f.calls),[['list',{ownerId:id,limit:200,offset:0}],['list',{ownerId:id,limit:200,offset:200}]]);assert.equal(f.legacy,0);
 assert.deepEqual(plain(await f.listStoredListingsForSeller('bad')),[]);assert.equal(f.calls.length,2);
});
test('primary public errors propagate for every adapter rather than returning fake empty success or invoking legacy storage',async()=>{
 const f=fixture({failed:true});for(const action of [()=>f.getStoredListingById(id,{publicOnly:true}),()=>f.listStoredListings(),()=>f.listStoredListingsForCategory('sad-i-rasteniya'),()=>f.listStoredListingsForSeller(id)])await assert.rejects(action(),/Synthetic primary unavailable/);
 assert.equal(f.legacy,0);assert.equal(f.calls.length,4);
});
