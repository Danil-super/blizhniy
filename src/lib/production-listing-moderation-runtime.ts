import {authJson} from './auth-http';import {readProductionAuthConfig} from './production-auth-config';
import {getProductionAccountDatabase} from './production-auth-runtime';import {PostgresListingModerationStore} from './postgres-listing-moderation';
import {createProductionListingModerationHandler} from './production-listing-moderation-http';
export async function handleProductionListingModerationRequest(request:Request){
 try{
  const config=readProductionAuthConfig();if(!config)return authJson({error:{code:'NOT_FOUND'}},404);
  return await createProductionListingModerationHandler(config,async()=>{
   const {db,limiter}=await getProductionAccountDatabase(config);return{store:new PostgresListingModerationStore(db),limiter};
  })(request);
 }catch{return authJson({error:{code:'MODERATION_UNAVAILABLE'}},503);}
}
