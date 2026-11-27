import 'server-only';
import {readProductionAuthConfig} from './production-auth-config';
import {getProductionAccountDatabase} from './production-auth-runtime';
import {readPostmoderationEnabled} from './listing-workflow-config';
import {PostgresPublicSearchStore} from './postgres-public-search';
import {parsePublicSearchInput,PublicSearchError,type PublicSearchInput} from './public-search-contract';
let active=0;
type WaitingSearch={start:()=>void};
const waiting:WaitingSearch[]=[];
function pump(){while(active<2&&waiting.length)waiting.shift()!.start();}
function acquireSearchSlot(deadline:number):Promise<()=>void>{
 const reserve=()=>{
  active++;let released=false;
  return()=>{if(!released){released=true;active--;pump();}};
 };
 if(!waiting.length&&active<2)return Promise.resolve(reserve());
 if(waiting.length>=32)return Promise.reject(new PublicSearchError());
 return new Promise((resolve,reject)=>{
  let pending=true;const expiresAt=Math.min(deadline,performance.now()+750);
  const job:WaitingSearch={start:()=>{
   if(!pending)return;pending=false;clearTimeout(timer);
   if(performance.now()>=expiresAt){reject(new PublicSearchError());return;}
   resolve(reserve());
  }};
  const timer=setTimeout(()=>{
   if(!pending)return;pending=false;
   const index=waiting.indexOf(job);if(index>=0)waiting.splice(index,1);
   reject(new PublicSearchError());pump();
  },Math.max(1,Math.ceil(expiresAt-performance.now())));
  waiting.push(job);
 });
}
/** Two physical leases plus a short bounded FIFO leave auth capacity in the shared pool. */
export async function searchPrimaryPublications(value:PublicSearchInput){
 const input=parsePublicSearchInput(value),deadline=performance.now()+5000;
 const release=await acquireSearchSlot(deadline);
 let delegated=false,initializing=false;
 try{
  const config=readProductionAuthConfig();if(!config||performance.now()>=deadline)throw new PublicSearchError();
  const pending=getProductionAccountDatabase(config);initializing=true;
  // The initializer is shared with auth. Bound this waiter without canceling it
  // or freeing search admission while its outstanding acquisition is unresolved.
  const {db}=await new Promise<Awaited<typeof pending>>((resolve,reject)=>{
   let expired=false;
   const timer=setTimeout(()=>{expired=true;reject(new PublicSearchError());},Math.max(1,deadline-performance.now()));
   void pending.then(value=>{initializing=false;clearTimeout(timer);if(expired){release();return;}resolve(value);},
    error=>{initializing=false;clearTimeout(timer);if(expired){release();return;}reject(error);});
  });
  const timeoutMs=Math.ceil(deadline-performance.now());if(timeoutMs<=0)throw new PublicSearchError();
  const store=new PostgresPublicSearchStore(db,{postmoderation:readPostmoderationEnabled(),specialistProfileIdentity:true});
  delegated=true;return await store.search(input,{onComplete:release,timeoutMs,deadline,verifyListingBlocks:true});
 }finally{if(!delegated&&!initializing)release();}
}
