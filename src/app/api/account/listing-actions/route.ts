import {authJson} from '@/lib/auth-http';
import {readPostmoderationEnabled} from '@/lib/listing-workflow-config';
import {readProductionAuthConfig} from '@/lib/production-auth-config';
import {getProductionAccountDatabase} from '@/lib/production-auth-runtime';
import {PostgresListingOwnerActions} from '@/lib/postgres-listing-owner-actions';
import {createListingOwnerActionsHandler} from '@/lib/listing-owner-actions-http';
export const runtime='nodejs';
export async function POST(request:Request){
 try{
  const config=readProductionAuthConfig();if(!config||!readPostmoderationEnabled())return authJson({error:{code:'NOT_FOUND'}},404);
  return await createListingOwnerActionsHandler(config,async()=>{const {db,limiter}=await getProductionAccountDatabase(config);return{store:new PostgresListingOwnerActions(db),limiter};})(request);
 }catch{return authJson({error:{code:'ACTION_UNAVAILABLE'}},503);}
}
