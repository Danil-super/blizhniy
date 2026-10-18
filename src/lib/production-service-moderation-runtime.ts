import {authJson} from './auth-http';import {readProductionAuthConfig} from './production-auth-config';import {getProductionAccountDatabase} from './production-auth-runtime';
import {getProductionMediaFileReader} from './production-media-runtime';import {PostgresServiceModerationStore} from './postgres-service-moderation';import {createProductionServiceModerationHandler} from './production-service-moderation-http';
export async function handleProductionServiceModerationRequest(request:Request,mode:'owner'|'admin'){
 try{
  const config=readProductionAuthConfig();if(!config)return authJson({error:{code:'NOT_FOUND'}},404);
  return await createProductionServiceModerationHandler(config,mode,async()=>{
   const {db,limiter}=await getProductionAccountDatabase(config);await db.query('select id,publication_id,revision,state,decision_note from app.service_moderation limit 0');
   return{store:new PostgresServiceModerationStore(db,{read:async record=>(await getProductionMediaFileReader(config)).read(record)}),limiter};
  })(request);
 }catch{return authJson({error:{code:'SERVICE_MODERATION_UNAVAILABLE'}},503);}
}
