import {authJson} from './auth-http';import {readProductionAuthConfig} from './production-auth-config';
import {getProductionAccountDatabase} from './production-auth-runtime';import {PostgresListingModerationStore} from './postgres-listing-moderation';
import {getProductionMediaFileReader} from './production-media-runtime';import {IdentityStore} from './identity';
import {createAdminListingModerationHandler} from './admin-listing-moderation-http';
export async function handleAdminListingModerationRequest(request:Request){
 try{
  const config=readProductionAuthConfig();if(!config)return authJson({error:{code:'NOT_FOUND'}},404);
  return await createAdminListingModerationHandler(config,async()=>{
   const {db,limiter}=await getProductionAccountDatabase(config);
   const store=new PostgresListingModerationStore(db,{read:async record=>(await getProductionMediaFileReader(config)).read(record)},{contactMethod:process.env.BLIZHNIY_LISTING_CONTACT_METHOD==='enabled'});
   return{store,limiter,identity:new IdentityStore(db)};
  })(request);
 }catch{return authJson({error:{code:'MODERATION_UNAVAILABLE'}},503);}
}
