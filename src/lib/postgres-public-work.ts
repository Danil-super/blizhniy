import {mapPublicWorkPublication,type PublicWorkRow} from './public-work-publications.ts';
import {parseListingDraftId,ListingDraftInputError} from './listing-draft-contract.ts';
import type {WorkPublicationKind} from './work-publication-contract';
import type {PostgresQueries} from './postgres';
import type {JobVacancy,WorkRequest} from './types';
import type {MediaFileRecord} from './media-files';
import {readPostmoderationEnabled} from './listing-workflow-config';
import {professionFormSql} from './profession-reference';
export type PublicWorkPhoto={record:MediaFileRecord;revision:string;expiresAt:string};
const references=`from app.work_publications w
 join app.users author on author.id=w.author_id and not author.is_blocked and author.email_verified_at is not null
 join app.cities city on city.id=w.city_id
 join app.specialist_categories profession on profession.id=w.profession_id and profession.active
  and (not(w.form ? 'professionId') or w.form->>'professionId'=w.profession_id::text)`;
const source=`${references} join app.work_moderation review on review.publication_id=w.id and review.revision=w.revision and review.state='approved'`;
const localSource=`${references} join lateral (select i.target_revision as purchased_revision from app.payment_checkout_intents i
   join app.payment_orders o on o.id=i.id and o.status='succeeded'
   join app.payment_fulfillments f on f.intent_id=i.id
   where w.kind in ('vacancy','workRequest') and city.name=w.form->>'cityName'
    and i.target_type=w.kind and i.target_id=w.id and i.owner_id=w.author_id and i.target_revision<=w.revision
    and i.is_test and i.merchant_shop_id='local-fixture-shop' and f.published_at=w.published_at and f.expires_at=w.expires_at
   order by i.target_revision limit 1) eligibility on true`;
// Financial publication fields are writable only by trusted server operations.
// Postmoderation must not hide a paid placement merely because its author edited it.
// Prior approval is retained only as the baseline for the displayed update date.
const postmoderationSource=`${references} left join lateral (select max(review.revision) as purchased_revision
 from app.work_moderation review where review.publication_id=w.id and review.state='approved' and review.revision<=w.revision) eligibility on true`;
const live=`w.status='published' and w.is_paid and w.deleted_at is null and w.published_at<=statement_timestamp() and w.expires_at>statement_timestamp()`;
const columns=`w.id,w.kind,${professionFormSql('w')} as form,w.profession_id as "professionId",w.status,w.is_paid as paid,
 to_char(w.updated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "updatedAt",
 to_char(w.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "createdAt",
 to_char(w.published_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "publishedAt",
 to_char(w.expires_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "expiresAt",
 array(select photo.media_id::text from app.work_publication_photos photo join app.media_objects image
  on image.id=photo.media_id and image.owner_id=w.author_id and image.state='ready'
  where photo.publication_id=w.id order by photo.position) as "mediaIds"`;
const checkKind=(kind:WorkPublicationKind)=>{if(kind!=='vacancy'&&kind!=='workRequest')throw new ListingDraftInputError();};

/** Public eligibility is independent of owner/editor reads and never synthesizes legacy records. */
export class PostgresPublicWorkStore{
 private readonly source:string;
  private readonly columns:string;
  private readonly available:string;
 constructor(private readonly db:PostgresQueries,policy:{vacancyPostmoderation?:boolean}={}){
  if(typeof window!=='undefined')throw Error('Public work storage is server-only');
  if(policy.vacancyPostmoderation&&!readPostmoderationEnabled())throw Error('Local vacancy workflow unavailable');
  const simulation=process.env.BLIZHNIY_LOCAL_PRIMARY==='enabled';
  this.source=policy.vacancyPostmoderation?(simulation?localSource:postmoderationSource):source;
   this.columns=columns+(policy.vacancyPostmoderation?`, w.revision>eligibility.purchased_revision as "contentEdited",
    exists(select 1 from app.payment_checkout_intents i join app.payment_fulfillments f on f.intent_id=i.id
     where i.target_type=w.kind and i.target_id=w.id and i.owner_id=w.author_id and i.is_test
      and i.request_body::jsonb->'metadata'->>'publicationMode'='account-test-v1'
      and f.published_at=w.published_at and f.expires_at=w.expires_at) as "testPublication"`:'');
   this.available=live+(policy.vacancyPostmoderation?" and (w.kind<>'workRequest' or not exists(select 1 from app.applications chosen where chosen.work_publication_id=w.id and chosen.status='selected' and chosen.is_paid and chosen.sent_at is not null))":'');
 }
 private async listRows(kind:WorkPublicationKind,limit:number,offset:number){
  checkKind(kind);if(!Number.isSafeInteger(limit)||limit<1||limit>1000||!Number.isSafeInteger(offset)||offset<0||offset>1000000)throw new ListingDraftInputError();
   const rows=(await this.db.query<PublicWorkRow>(`select ${this.columns} ${this.source} where ${this.available} and w.kind=$1
   order by w.published_at desc,w.created_at desc,w.id desc limit $2 offset $3`,[kind,limit,offset], "bounded-read")).rows;
  return rows;
 }
 list(kind:'vacancy',limit?:number,offset?:number):Promise<JobVacancy[]>;
 list(kind:'workRequest',limit?:number,offset?:number):Promise<WorkRequest[]>;
 list(kind:WorkPublicationKind,limit?:number,offset?:number):Promise<(JobVacancy|WorkRequest)[]>;
 async list(kind:WorkPublicationKind,limit=24,offset=0):Promise<(JobVacancy|WorkRequest)[]>{
  return (await this.listRows(kind,limit,offset)).map(row=>mapPublicWorkPublication(row,Date.now())).filter((item):item is JobVacancy|WorkRequest=>item!==null);
 }
 searchScope(){return{source:this.source,eligible:this.available};}
 async readMany(values:unknown[]):Promise<(JobVacancy|WorkRequest)[]>{
  if(!Array.isArray(values)||values.length>25)throw new ListingDraftInputError();
  const ids=values.map(parseListingDraftId);if(new Set(ids).size!==ids.length)throw new ListingDraftInputError();if(!ids.length)return[];
  const rows=(await this.db.query<PublicWorkRow>(`select ${this.columns} ${this.source}
   where w.id=any($1::uuid[]) and ${this.available} limit 25`,[ids])).rows;
  return rows.map(row=>mapPublicWorkPublication(row,Date.now())).filter((row):row is JobVacancy|WorkRequest=>row!==null);
 }
 async sitemapPage(kind:WorkPublicationKind,limit=100,offset=0){
  const rows=await this.listRows(kind,limit,offset);
  const entries=rows.filter(row=>row.testPublication!==true).map(row=>mapPublicWorkPublication(row,Date.now())).filter((item):item is JobVacancy|WorkRequest=>item!==null)
   .map(({id,publishedAt})=>({id,publishedAt}));
  return{entries,hasMore:rows.length===limit};
 }
 read(kind:'vacancy',publicationId:unknown):Promise<JobVacancy|undefined>;
 read(kind:'workRequest',publicationId:unknown):Promise<WorkRequest|undefined>;
 read(kind:WorkPublicationKind,publicationId:unknown):Promise<JobVacancy|WorkRequest|undefined>;
 async read(kind:WorkPublicationKind,publicationId:unknown):Promise<JobVacancy|WorkRequest|undefined>{
  checkKind(kind);let id:string;try{id=parseListingDraftId(publicationId);}catch{return undefined;}
   const row=(await this.db.query<PublicWorkRow>(`select ${this.columns} ${this.source} where ${this.available} and w.kind=$1 and w.id=$2 limit 1`,[kind,id])).rows[0];
  return row?mapPublicWorkPublication(row,Date.now())??undefined:undefined;
 }
 async photoRecord(publicationId:unknown,fileId:unknown):Promise<PublicWorkPhoto|undefined>{
  let id:string,media:string;try{id=parseListingDraftId(publicationId);media=parseListingDraftId(fileId);}catch{return undefined;}
  const row=(await this.db.query<PublicWorkRow&{revision:string;record:MediaFileRecord}>(`select ${this.columns},w.revision::text as revision,
   json_build_object('id',image.id,'mimeType',image.mime_type,'width',image.width,'height',image.height,'size',image.size,'sha256',image.sha256) as record
   ${this.source} join app.work_publication_photos attachment on attachment.publication_id=w.id
   join app.media_objects image on image.id=attachment.media_id and image.owner_id=w.author_id and image.state='ready'
    where ${this.available} and w.id=$1 and image.id=$2 limit 1`,[id,media])).rows[0];
  if(!row||!mapPublicWorkPublication(row,Date.now())||!row.mediaIds.includes(media))return undefined;
  return{record:row.record,revision:row.revision,expiresAt:row.expiresAt!};
 }
}
