import {createAdminPublicationRestrictionHandler} from '@/lib/admin-publication-restriction-http';
import {authJson} from '@/lib/auth-http';
import {readProductionAuthConfig} from '@/lib/production-auth-config';
import {getProductionAccountDatabase} from '@/lib/production-auth-runtime';
import {readPublicationRestrictionEnabled} from '@/lib/publication-restriction-config';
import {callHostedPublicationRestrictionOperator} from '@/lib/publication-restriction-operator-client';

export const runtime='nodejs';
export const dynamic='force-dynamic';

export async function POST(request:Request){
 if(!readPublicationRestrictionEnabled())return authJson({error:{code:'NOT_FOUND'}},404);
 try{
  const config=readProductionAuthConfig();
  if(!config)return authJson({error:{code:'NOT_FOUND'}},404);
  return await createAdminPublicationRestrictionHandler(config,async()=>{
   const {db,limiter}=await getProductionAccountDatabase(config);
   return {db,limiter,execute:callHostedPublicationRestrictionOperator};
  })(request);
 }catch{
  return authJson({error:{code:'ACCESS_UNAVAILABLE'}},503);
 }
}
