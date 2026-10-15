import {authJson} from './auth-http';
import {readProductionAuthConfig} from './production-auth-config';
import {getProductionAccountDatabase} from './production-auth-runtime';
import {PostgresListingFormStore} from './postgres-listing-form';
import {createProductionListingFormHandler} from './production-listing-form-http';
export async function handleProductionListingFormRequest(request:Request){
 try{
  const config=readProductionAuthConfig();if(!config)return authJson({error:{code:'NOT_FOUND'}},404);
  return await createProductionListingFormHandler(config,async()=>{
   const {db,limiter}=await getProductionAccountDatabase(config);
   await db.query('select district,address,latitude,longitude,show_exact_address,contact_phone,messenger_url,booking from app.listings limit 0');
   return{store:new PostgresListingFormStore(db),limiter};
  })(request);
 }catch{return authJson({error:{code:'FORM_UNAVAILABLE'}},503);}
}
