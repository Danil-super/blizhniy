import {mapPublicWorkPublication,type PublicWorkRow} from './public-work-publications.ts';
import {parseListingDraftId,ListingDraftInputError} from './listing-draft-contract.ts';
import type {WorkPublicationKind} from './work-publication-contract';
import type {PostgresQueries} from './postgres';
import type {JobVacancy,WorkRequest} from './types';
import type {MediaFileRecord} from './media-files';
export type PublicWorkPhoto={record:MediaFileRecord;revision:string;expiresAt:string};
const source=`from app.work_publications w
 join app.users author on author.id=w.author_id and not author.is_blocked and author.email_verified_at is not null
 join app.cities city on city.id=w.city_id
 join app.specialist_categories profession on profession.id=w.profession_id and profession.active
 join app.work_moderation review on review.publication_id=w.id and review.revision=w.revision and review.state='approved'`;
const live=`w.status='published' and w.is_paid and w.deleted_at is null and w.published_at<=statement_timestamp() and w.expires_at>statement_timestamp()`;
const columns=`w.id,w.kind,w.form,w.status,w.is_paid as paid,
 to_char(w.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "createdAt",
 to_char(w.published_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "publishedAt",
 to_char(w.expires_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "expiresAt",
 array(select photo.media_id::text from app.work_publication_photos photo join app.media_objects image
  on image.id=photo.media_id and image.owner_id=w.author_id and image.state='ready'
  where photo.publication_id=w.id order by photo.position) as "mediaIds"`;
const checkKind=(kind:WorkPublicationKind)=>{if(kind!=='vacancy'&&kind!=='workRequest')throw new ListingDraftInputError();};

/** Public eligibility is independent of owner/editor reads and never synthesizes legacy records. */
export class PostgresPublicWorkStore{
 constructor(private readonly db:PostgresQueries){if(typeof window!=='undefined')throw Error('Public work storage is server-only');}
 list(kind:'vacancy',limit?:number,offset?:number):Promise<JobVacancy[]>;
 list(kind:'workRequest',limit?:number,offset?:number):Promise<WorkRequest[]>;
 list(kind:WorkPublicationKind,limit?:number,offset?:number):Promise<(JobVacancy|WorkRequest)[]>;
 async list(kind:WorkPublicationKind,limit=24,offset=0):Promise<(JobVacancy|WorkRequest)[]>{
  checkKind(kind);if(!Number.isSafeInteger(limit)||limit<1||limit>1000||!Number.isSafeInteger(offset)||offset<0||offset>1000000)throw new ListingDraftInputError();
  const rows=(await this.db.query<PublicWorkRow>(`select ${columns} ${source} where ${live} and w.kind=$1
   order by w.published_at desc,w.created_at desc,w.id desc limit $2 offset $3`,[kind,limit,offset])).rows;
  return rows.map(row=>mapPublicWorkPublication(row,Date.now())).filter((item):item is JobVacancy|WorkRequest=>item!==null);
 }
 read(kind:'vacancy',publicationId:unknown):Promise<JobVacancy|undefined>;
 read(kind:'workRequest',publicationId:unknown):Promise<WorkRequest|undefined>;
 read(kind:WorkPublicationKind,publicationId:unknown):Promise<JobVacancy|WorkRequest|undefined>;
 async read(kind:WorkPublicationKind,publicationId:unknown):Promise<JobVacancy|WorkRequest|undefined>{
  checkKind(kind);let id:string;try{id=parseListingDraftId(publicationId);}catch{return undefined;}
  const row=(await this.db.query<PublicWorkRow>(`select ${columns} ${source} where ${live} and w.kind=$1 and w.id=$2 limit 1`,[kind,id])).rows[0];
  return row?mapPublicWorkPublication(row,Date.now())??undefined:undefined;
 }
 async photoRecord(publicationId:unknown,fileId:unknown):Promise<PublicWorkPhoto|undefined>{
  let id:string,media:string;try{id=parseListingDraftId(publicationId);media=parseListingDraftId(fileId);}catch{return undefined;}
  const row=(await this.db.query<PublicWorkRow&{revision:string;record:MediaFileRecord}>(`select ${columns},w.revision::text as revision,
   json_build_object('id',image.id,'mimeType',image.mime_type,'width',image.width,'height',image.height,'size',image.size,'sha256',image.sha256) as record
   ${source} join app.work_publication_photos attachment on attachment.publication_id=w.id
   join app.media_objects image on image.id=attachment.media_id and image.owner_id=w.author_id and image.state='ready'
   where ${live} and w.id=$1 and image.id=$2 limit 1`,[id,media])).rows[0];
  if(!row||!mapPublicWorkPublication(row,Date.now())||!row.mediaIds.includes(media))return undefined;
  return{record:row.record,revision:row.revision,expiresAt:row.expiresAt!};
 }
}
