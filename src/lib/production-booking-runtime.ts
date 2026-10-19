import {authJson} from './auth-http';import {readProductionAuthConfig} from './production-auth-config';
import {getProductionAccountDatabase} from './production-auth-runtime';import {PostgresBookingStore,PostgresBookingAvailabilityStore} from './postgres-bookings';import {createProductionBookingHandler} from './production-booking-http';
import {createProductionBookingInventoryHandler} from './production-booking-inventory-http';
export async function handleProductionBookingRequest(request:Request){
 try{
  const config=readProductionAuthConfig();if(!config)return authJson({error:{code:'NOT_FOUND'}},404);
  return await createProductionBookingHandler(config,async()=>{
   const {db,limiter}=await getProductionAccountDatabase(config);
   await db.query('select id,listing_id,guest_id,creation_key,mode,start_date,end_date,guests,total,details_snapshot,revision,status,created_at,updated_at,decided_at from app.booking_requests limit 0');
   await db.query('select is_paid,published_at,expires_at from app.listings limit 0');return{store:new PostgresBookingStore(db),limiter};
  })(request);
 }catch{return authJson({error:{code:'BOOKINGS_UNAVAILABLE'}},503);}
}
export async function handleProductionBookingInventory(request:Request,listingId:unknown){
 try{
  const config=readProductionAuthConfig();if(!config)return authJson({error:{code:'NOT_FOUND'}},404);
  return await createProductionBookingInventoryHandler(config,async()=>new PostgresBookingAvailabilityStore((await getProductionAccountDatabase(config)).db))(request,listingId);
 }catch{return authJson({error:{code:'BOOKINGS_UNAVAILABLE'}},503);}
}
