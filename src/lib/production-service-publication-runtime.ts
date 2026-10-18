import {authJson} from './auth-http';import {readProductionAuthConfig} from './production-auth-config';
import {getProductionAccountDatabase} from './production-auth-runtime';import {PostgresServicePublicationStore} from './postgres-service-publications';
import {createProductionServicePublicationHandler} from './production-service-publication-http';
export async function handleProductionServicePublicationRequest(request:Request){
 try{
  const config=readProductionAuthConfig();if(!config)return authJson({error:{code:'NOT_FOUND'}},404);
  return await createProductionServicePublicationHandler(config,async()=>{
   const {db,limiter}=await getProductionAccountDatabase(config);
   await db.query('select id,author_id,kind,creation_key,form,revision,status,is_paid,city_id,profession_id,created_at,updated_at,published_at,expires_at,deleted_at from app.service_publications limit 0');
   await db.query('select publication_id,media_id,position from app.service_publication_photos limit 0');
   return{store:new PostgresServicePublicationStore(db),limiter};
  })(request);
 }catch{return authJson({error:{code:'SERVICE_PUBLICATIONS_UNAVAILABLE'}},503);}
}
