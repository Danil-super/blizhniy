import type {PostgresDatabase} from './postgres';
import {expireBookingRequests} from './postgres-bookings';
/** No user session, acceptance or cancellation capability. One parent and <=100 rows per tick. */
export class PostgresBookingExpiryStore {
 constructor(private readonly db:Pick<PostgresDatabase,'transaction'>){}
 tick(){return this.db.transaction(async tx=>{
  const target=(await tx.query<{id:string}>(`select id from app.listings where id in
   (select listing_id from app.booking_requests where status='pending' and expires_at<=clock_timestamp() and revision<9223372036854775807 order by expires_at,id limit 100)
   order by id for update skip locked limit 1`)).rows[0];
  if(!target)return{state:'idle' as const,expired:0};
  const result=await expireBookingRequests(tx,target.id);
  return{state:'completed' as const,expired:result.rowCount};
 });}
}
