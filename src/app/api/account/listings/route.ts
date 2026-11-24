import {authJson} from '@/lib/auth-http';
import {readProductionAuthConfig} from '@/lib/production-auth-config';
import {getProductionAccountDatabase} from '@/lib/production-auth-runtime';
import {PostgresListingCabinetStore} from '@/lib/postgres-listing-cabinet';
import {createListingCabinetHandler} from '@/lib/listing-cabinet-http';
import {readPostmoderationEnabled} from '@/lib/listing-workflow-config';
export const runtime='nodejs';
export async function POST(request:Request){
 try{
  const config=readProductionAuthConfig(),postmoderation=readPostmoderationEnabled();
  if(!config||!postmoderation)return authJson({error:{code:'NOT_FOUND'}},404);
  return await createListingCabinetHandler(config,async()=>{const {db,limiter}=await getProductionAccountDatabase(config);return{store:new PostgresListingCabinetStore(db,postmoderation),limiter};})(request);
 }catch{return authJson({error:{code:'LISTINGS_UNAVAILABLE'}},503);}
}
export function GET(){return authJson({error:{code:'METHOD_NOT_ALLOWED'}},405,{Allow:'POST'});}
