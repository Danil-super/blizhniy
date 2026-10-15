import {authJson} from './auth-http';import {readProductionAuthConfig} from './production-auth-config';
import {getProductionAccountDatabase} from './production-auth-runtime';import {PostgresListingFormStore} from './postgres-listing-form';
import {createProductionListingPublicationHandler} from './production-listing-publication-http';
export async function handleProductionListingPublicationRequest(request:Request){
 try{
  const config=readProductionAuthConfig();if(!config)return authJson({error:{code:'NOT_FOUND'}},404);
  return await createProductionListingPublicationHandler(config,async()=>{
   const {db,limiter}=await getProductionAccountDatabase(config);return{store:new PostgresListingFormStore(db),limiter};
  })(request);
 }catch{return authJson({error:{code:'PUBLICATION_CHECK_UNAVAILABLE'}},503);}
}
