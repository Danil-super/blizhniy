import {PostgresApplicationCompensationStore} from './postgres-application-compensation.ts';
import {parseListingDraftId} from './listing-draft-contract.ts';
import type {PostgresDatabase} from './postgres.ts';

export type ApplicationCompensationDiscoveryResult={scanned:number;skipped:number;claimed:number;waiting:number;ineligible:number;unavailable:number};
/** Bounded candidate intake only. The existing locked policy alone admits a case. */
export class PostgresApplicationCompensationDiscovery {
 private readonly db:Pick<PostgresDatabase,'transaction'>;
 private readonly shopId:string;
 private readonly cases:PostgresApplicationCompensationStore;
 constructor(db:Pick<PostgresDatabase,'transaction'>,merchant:{shopId:string;isTest:boolean}){
  this.cases=new PostgresApplicationCompensationStore(db,merchant);this.db=db;this.shopId=merchant.shopId;
 }
 async scan(limit=10):Promise<ApplicationCompensationDiscoveryResult>{
  if(!Number.isInteger(limit)||limit<1||limit>25)throw Error('Invalid compensation discovery limit');
  // Unknown page COMMIT stops before intake; the cyclic scan will revisit it.
  const page=await this.db.transaction(async tx=>{
   const raw=(await tx.query<{page:unknown}>('select app.next_application_compensation_candidates($1,$2) as page',[this.shopId,limit])).rows[0]?.page;
   if(!raw||typeof raw!=='object'||Array.isArray(raw)||Object.keys(raw).length!==2||!('visited'in raw)||!('ids'in raw)||
    typeof raw.visited!=='number'||!Number.isInteger(raw.visited)||raw.visited<0||raw.visited>limit||!Array.isArray(raw.ids)||raw.ids.length>raw.visited)throw Error('Invalid compensation discovery page');
   const ids=raw.ids.map(parseListingDraftId);if(new Set(ids).size!==ids.length)throw Error('Invalid compensation discovery page');
   return{visited:raw.visited,ids};
  });
  const result:ApplicationCompensationDiscoveryResult={scanned:page.visited,skipped:page.visited-page.ids.length,claimed:0,waiting:0,ineligible:0,unavailable:0};
  for(const id of page.ids){
   try{const outcome=await this.cases.claim(id);
    if(outcome.state==='ineligible'&&outcome.reason==='legacy-unknown')result.unavailable++;
    else result[outcome.state]++;
   }
   // No SQL replay, new key or fabricated absence of disclosure on a failed read.
   catch{result.unavailable++;}
  }
  return result;
 }
}
