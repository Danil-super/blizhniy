import {mapPublicServicePublication,type PublicServiceRow,type PublicServiceMaterial,type PublicMarquee} from './public-service-publications.ts';
import {parseListingDraftId,ListingDraftInputError} from './listing-draft-contract.ts';
import type {ServicePublicationKind} from './service-publication-contract';import type {PostgresQueries} from './postgres';import type {SpecialistProfile,FairApplication} from './types';
import type {MediaFileRecord} from './media-files';
const source=`from app.service_publications s
 join app.users author on author.id=s.author_id and not author.is_blocked and author.email_verified_at is not null
 left join app.cities city on city.id=s.city_id and city.name=s.form->>'cityName'
 left join app.specialist_categories profession on profession.id=s.profession_id and profession.name=s.form->>'professionName' and profession.active
 join app.service_moderation review on review.publication_id=s.id and review.revision=s.revision and review.state='approved'`;
const live=`s.status='published' and s.is_paid and s.deleted_at is null and s.published_at<=statement_timestamp() and s.expires_at>statement_timestamp()
 and (s.kind='marquee' or city.id is not null) and (s.kind<>'specialist' or profession.id is not null)`;
const columns=`s.id,s.kind,s.form,s.status,s.is_paid as paid,
 to_char(s.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "createdAt",
 to_char(s.published_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "publishedAt",
 to_char(s.expires_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "expiresAt",
 array(select attachment.media_id::text from app.service_publication_photos attachment join app.media_objects image
 on image.id=attachment.media_id and image.owner_id=s.author_id and image.state='ready' where attachment.publication_id=s.id order by attachment.position) as "mediaIds"`;
function checkKind(kind:ServicePublicationKind){if(!['specialist','fair','marquee'].includes(kind))throw new ListingDraftInputError();}
/** Only current approved, paid, live rows; private editor reads never authorize public output. */
export class PostgresPublicServiceStore{
 constructor(private readonly db:PostgresQueries){if(typeof window!=='undefined')throw Error('Public service storage is server-only');}
 list(kind:'specialist',limit?:number,offset?:number):Promise<SpecialistProfile[]>;
 list(kind:'fair',limit?:number,offset?:number):Promise<FairApplication[]>;
 list(kind:'marquee',limit?:number,offset?:number):Promise<PublicMarquee[]>;
 list(kind:ServicePublicationKind,limit?:number,offset?:number):Promise<PublicServiceMaterial[]>;
 async list(kind:ServicePublicationKind,limit=kind==='marquee'?5:24,offset=0):Promise<PublicServiceMaterial[]>{
  checkKind(kind);if(!Number.isSafeInteger(limit)||limit<1||limit>(kind==='marquee'?5:1000)||!Number.isSafeInteger(offset)||offset<0||offset>1000000||kind==='marquee'&&offset!==0)throw new ListingDraftInputError();
  const order=kind==='marquee'?'s.published_at,s.created_at,s.id':'s.published_at desc,s.created_at desc,s.id desc';
  const rows=(await this.db.query<PublicServiceRow>(`select ${columns} ${source} where ${live} and s.kind=$1 order by ${order} limit $2 offset $3`,[kind,limit,offset])).rows;
  return rows.map(row=>mapPublicServicePublication(row,Date.now())).filter((row):row is PublicServiceMaterial=>row!==null);
 }
 read(kind:'specialist',id:unknown):Promise<SpecialistProfile|undefined>;
 read(kind:'fair',id:unknown):Promise<FairApplication|undefined>;
 read(kind:'marquee',id:unknown):Promise<PublicMarquee|undefined>;
 read(kind:ServicePublicationKind,id:unknown):Promise<PublicServiceMaterial|undefined>;
 async read(kind:ServicePublicationKind,publication:unknown):Promise<PublicServiceMaterial|undefined>{
  checkKind(kind);let id:string;try{id=parseListingDraftId(publication);}catch{return undefined;}
  const row=(await this.db.query<PublicServiceRow>(`select ${columns} ${source} where ${live} and s.kind=$1 and s.id=$2 limit 1`,[kind,id])).rows[0];
  return row?mapPublicServicePublication(row,Date.now())??undefined:undefined;
 }
 async photoRecord(publication:unknown,file:unknown):Promise<{record:MediaFileRecord;revision:string;expiresAt:string}|undefined>{
  let id:string,media:string;try{id=parseListingDraftId(publication);media=parseListingDraftId(file);}catch{return undefined;}
  const row=(await this.db.query<PublicServiceRow&{record:MediaFileRecord;revision:string}>(`select ${columns},s.revision::text as revision,
   json_build_object('id',image.id,'mimeType',image.mime_type,'width',image.width,'height',image.height,'size',image.size,'sha256',image.sha256) as record
   ${source} join app.service_publication_photos attachment on attachment.publication_id=s.id
   join app.media_objects image on image.id=attachment.media_id and image.owner_id=s.author_id and image.state='ready'
   where ${live} and s.kind<>'marquee' and s.id=$1 and image.id=$2 limit 1`,[id,media])).rows[0];
  if(!row||!mapPublicServicePublication(row,Date.now())||!row.mediaIds.includes(media))return undefined;
  return{record:row.record,revision:row.revision,expiresAt:row.expiresAt!};
 }
}
