import type {PostgresDatabase,PostgresQueries} from './postgres.ts';

export async function expireBookingRequests(tx:PostgresQueries,listingId:string,id:string|null=null){
 return tx.query(`update app.booking_requests set status='expired',revision=revision+1,updated_at=clock_timestamp(),decided_at=clock_timestamp()
  where id in (select id from app.booking_requests where listing_id=$1 and ($2::uuid is null or id=$2) and status='pending' and expires_at<=clock_timestamp() and revision<9223372036854775807 order by id limit 100)`,[listingId,id]);
}

/** No user session, acceptance or cancellation capability. One parent and <=100 rows per tick. */
export class PostgresBookingExpiryStore {
 private readonly db:Pick<PostgresDatabase,'transaction'>;
 constructor(db:Pick<PostgresDatabase,'transaction'>){this.db=db;}
 tick(){return this.db.transaction(async tx=>{
  const target=(await tx.query<{id:string}>(`select id from app.listings where id in
   (select listing_id from app.booking_requests where status='pending' and expires_at<=clock_timestamp() and revision<9223372036854775807 order by expires_at,id limit 100)
   order by id for update skip locked limit 1`)).rows[0];
  if(!target)return{state:'idle' as const,expired:0};
  const result=await expireBookingRequests(tx,target.id);
  return{state:'completed' as const,expired:result.rowCount};
 });}
}
