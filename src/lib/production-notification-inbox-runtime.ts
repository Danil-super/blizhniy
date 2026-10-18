import {authJson} from './auth-http';
import {readProductionAuthConfig} from './production-auth-config';
import {getProductionAccountDatabase} from './production-auth-runtime';
import {PostgresNotificationInbox} from './postgres-notification-inbox';
import {createProductionNotificationInboxHandler} from './production-notification-inbox-http';
export async function handleProductionNotificationInboxRequest(request:Request){
 try{
  const config=readProductionAuthConfig();if(!config)return authJson({error:{code:'NOT_FOUND'}},404);
  return await createProductionNotificationInboxHandler(config,async()=>{
   const {db,limiter}=await getProductionAccountDatabase(config);
   await db.query('select id,user_id,event_key,category,tone,title,body,action_href,booking_request_id,read_at,dismissed_at,created_at from app.notifications limit 0');
   return{store:new PostgresNotificationInbox(db),limiter};
  })(request);
 }catch{return authJson({error:{code:'NOTIFICATIONS_UNAVAILABLE'}},503);}
}
