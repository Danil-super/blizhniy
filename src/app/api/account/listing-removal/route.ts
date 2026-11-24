import {authJson} from '@/lib/auth-http';
import {readDraftRemovalsEnabled,readPostmoderationEnabled} from '@/lib/listing-workflow-config';
import {readProductionAuthConfig} from '@/lib/production-auth-config';
import {getProductionAccountDatabase} from '@/lib/production-auth-runtime';
import {PostgresListingOwnerRemovalStore} from '@/lib/postgres-listing-owner-removals';
import {createListingOwnerRemovalHandler} from '@/lib/listing-owner-removal-http';
export const runtime='nodejs';
export async function POST(request:Request){
 try{
  const config=readProductionAuthConfig();if(!config)return authJson({error:{code:'NOT_FOUND'}},404);
  const postmoderation=readPostmoderationEnabled(),draftRemovals=readDraftRemovalsEnabled();
  if(!postmoderation&&!draftRemovals)return authJson({error:{code:'NOT_FOUND'}},404);
  return await createListingOwnerRemovalHandler({...config,postmoderation,draftRemovals},async()=>{
   const {db,limiter}=await getProductionAccountDatabase(config);
   return{store:new PostgresListingOwnerRemovalStore(db),limiter};
  })(request);
 }catch{return authJson({error:{code:'REMOVAL_UNAVAILABLE'}},503);}
}
