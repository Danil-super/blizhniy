import {authJson} from './auth-http';
import {readProductionAuthConfig} from './production-auth-config';
import {getProductionAccountDatabase} from './production-auth-runtime';
import {getProductionMediaFileReader} from './production-media-runtime';
import {PostgresWorkModerationStore} from './postgres-work-moderation';
import {createProductionWorkModerationHandler} from './production-work-moderation-http';
export async function handleProductionWorkModerationRequest(request:Request,mode:'owner'|'admin'){
 try{
  const config=readProductionAuthConfig();if(!config)return authJson({error:{code:'NOT_FOUND'}},404);
  return await createProductionWorkModerationHandler(config,mode,async()=>{
   const {db,limiter}=await getProductionAccountDatabase(config);
   await db.query('select id,publication_id,revision,state,decision_note from app.work_moderation limit 0');
   const store=new PostgresWorkModerationStore(db,{read:async record=>(await getProductionMediaFileReader(config)).read(record)});return{store,limiter};
  })(request);
 }catch{return authJson({error:{code:'WORK_MODERATION_UNAVAILABLE'}},503);}
}
