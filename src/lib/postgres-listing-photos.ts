import {withAppSessionTransaction} from "./app-session-transaction";
import {parseListingDraftId,parseListingDraftRevision} from "./listing-draft-contract";
import {parseListingPhotoIds,type ListingDraftPhoto,type ListingDraftPhotos} from "./listing-photo-contract";
import {ListingDraftAccessError,ListingDraftConflictError} from "./postgres-listing-drafts";
import type {PostgresDatabase} from "./postgres";
const columns='m.id,m.mime_type as "mimeType",m.width,m.height,m.size';
const photo=(row:ListingDraftPhoto):ListingDraftPhoto=>({id:row.id,mimeType:row.mimeType,width:row.width,height:row.height,size:row.size});

/** Metadata associations only. No upload, paths, public serving, file deletion or automatic retry. */
export class PostgresListingPhotoStore{
  constructor(private readonly db:Pick<PostgresDatabase,"transaction">){
    if(typeof window!=="undefined")throw new Error("Listing photos are server-only");
  }
  async read(token:string,expectedOwnerId:string,listingId:unknown):Promise<ListingDraftPhotos>{
    return withAppSessionTransaction(this.db,token,async(tx,user)=>{
      if(user.id!==expectedOwnerId)throw new ListingDraftAccessError();
      const id=parseListingDraftId(listingId);
      const row=(await tx.query<{revision:string}>("select revision::text as revision from app.listings where id=$1 and author_id=$2 and status='draft'",[id,user.id])).rows[0];
      if(!row)throw new ListingDraftAccessError();
      const photos=(await tx.query<ListingDraftPhoto & {permitted:boolean}>(`select ${columns},(m.owner_id=$2 and m.state='ready') as permitted
        from app.listing_photos p join app.media_objects m on m.id=p.media_id where p.listing_id=$1 order by p.position limit 10001`,[id,user.id])).rows;
      if(photos.length>10000||photos.some(row=>row.permitted!==true))throw new ListingDraftAccessError();
      return{id,revision:row.revision,photos:photos.map(photo)};
    });
  }
  async replace(token:string,expectedOwnerId:string,listingId:unknown,expectedRevision:unknown,input:unknown):Promise<ListingDraftPhotos>{
    return withAppSessionTransaction(this.db,token,async(tx,user)=>{
      if(user.id!==expectedOwnerId)throw new ListingDraftAccessError();
      const id=parseListingDraftId(listingId),revision=parseListingDraftRevision(expectedRevision),ids=parseListingPhotoIds(input);
      const current=(await tx.query<{revision:string}>("select revision::text as revision from app.listings where id=$1 and author_id=$2 and status='draft' for update",[id,user.id])).rows[0];
      if(!current)throw new ListingDraftAccessError();
      if(current.revision!==revision||revision==="9223372036854775807")throw new ListingDraftConflictError();
      // Ready-state and owner metadata cannot change under the existing media trigger; FK prevents dangling links.
      const available=ids.length?(await tx.query<ListingDraftPhoto>(`select ${columns} from app.media_objects m
        where m.owner_id=$1 and m.state='ready' and m.id=any($2::uuid[])`,[user.id,ids])).rows:[];
      if(available.length!==ids.length)throw new ListingDraftAccessError();
      const byId=new Map(available.map(row=>[row.id,row]));
      const photos=ids.map(id=>{const row=byId.get(id);if(!row)throw new ListingDraftAccessError();return photo(row);});
      await tx.query("delete from app.listing_photos where listing_id=$1",[id]);
      if(ids.length){
        const inserted=await tx.query(`insert into app.listing_photos(listing_id,media_id,position)
          select $1,item.id,(item.position-1)::integer from unnest($2::uuid[]) with ordinality as item(id,position)`,[id,ids]);
        if(inserted.rowCount!==ids.length)throw new Error("Listing photo replacement unavailable");
      }
      const result=await tx.query<{revision:string}>(`update app.listings set revision=revision+1,updated_at=clock_timestamp()
        where id=$1 and author_id=$2 and status='draft' and revision=$3::bigint returning revision::text as revision`,[id,user.id,revision]);
      if(result.rowCount!==1||!result.rows[0])throw new ListingDraftConflictError();
      return{id,revision:result.rows[0].revision,photos};
    });
  }
}
