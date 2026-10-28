import {authJson} from './auth-http';
import {readProductionAuthConfig} from './production-auth-config';
import {getProductionAccountDatabase} from './production-auth-runtime';
import {PostgresListingManagementStore} from './postgres-listing-management';
import {getProductionMediaFileReader} from './production-media-runtime';
import {createAdminListingManagementHandler} from './admin-listing-management-http';
import {readPostmoderationEnabled} from './listing-workflow-config';
export async function handleAdminListingManagementRequest(request:Request){
 try{
  if(!readPostmoderationEnabled())return authJson({error:{code:'NOT_FOUND'}},404);
  const config=readProductionAuthConfig();if(!config)return authJson({error:{code:'NOT_FOUND'}},404);
  return await createAdminListingManagementHandler(config,async()=>{
   const {db,limiter}=await getProductionAccountDatabase(config);
   return {store:new PostgresListingManagementStore(db,{read:async record=>(await getProductionMediaFileReader(config)).read(record)}),limiter};
  })(request);
 }catch{return authJson({error:{code:'MANAGEMENT_UNAVAILABLE'}},503);}
}
