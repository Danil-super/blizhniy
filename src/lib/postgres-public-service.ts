import {mapPublicServicePublication,type PublicServiceRow,type PublicServiceMaterial,type PublicMarquee} from './public-service-publications.ts';
import {parseListingDraftId,ListingDraftInputError} from './listing-draft-contract.ts';
import type {ServicePublicationKind} from './service-publication-contract';import type {PostgresQueries} from './postgres';import type {SpecialistProfile,FairApplication} from './types';
import type {MediaFileRecord} from './media-files';
import {professionFormSql} from './profession-reference';
const source=`from app.service_publications s
 join app.users author on author.id=s.author_id and not author.is_blocked and author.email_verified_at is not null
 left join app.cities city on city.id=s.city_id and city.name=s.form->>'cityName'
 left join app.specialist_categories profession on profession.id=s.profession_id and profession.active
  and (not(s.form ? 'professionId') or s.form->>'professionId'=s.profession_id::text)
 join app.service_moderation review on review.publication_id=s.id and review.revision=s.revision and review.state='approved'`;
const live=`s.status='published' and s.is_paid and s.deleted_at is null and s.published_at<=statement_timestamp() and s.expires_at>statement_timestamp()
 and (s.kind='marquee' or city.id is not null) and (s.kind<>'specialist' or profession.id is not null)`;
const columns=`s.id,s.kind,${professionFormSql('s')} as form,s.profession_id as "professionId",s.status,s.is_paid as paid,
 to_char(s.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "createdAt",
 to_char(s.published_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "publishedAt",
 to_char(s.expires_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "expiresAt",
 array(select attachment.media_id::text from app.service_publication_photos attachment join app.media_objects image
 on image.id=attachment.media_id and image.owner_id=s.author_id and image.state='ready' where attachment.publication_id=s.id order by attachment.position) as "mediaIds"`;
function checkKind(kind:ServicePublicationKind){if(!['specialist','fair','marquee'].includes(kind))throw new ListingDraftInputError();}
/** Only current approved, paid, live rows; private editor reads never authorize public output. */
export class PostgresPublicServiceStore{
 constructor(private readonly db:PostgresQueries,private readonly options:{specialistProfileIdentity?:boolean;testPublicationLabels?:boolean}={}){if(typeof window!=='undefined')throw Error('Public service storage is server-only');}
 private get identityColumn(){return this.options.specialistProfileIdentity?`,case when s.kind='specialist' then
  (select json_build_object('name',profile->>'name','avatarDataUrl',coalesce(profile->>'avatarDataUrl','')) from app.cabinet_profiles where user_id=s.author_id)
  end as "profileIdentity"`:'';}
 private async specialistTestLabel(kind?:ServicePublicationKind){
  if(!this.options.testPublicationLabels||(kind!==undefined&&kind!=='specialist'))return '';
  // Earlier public-reader roles have no financial privileges. Only an installed specialist rollout can have labelled purchases.
  if(!(await this.db.query<{installed:boolean}>("select to_regclass('app.specialist_test_enrollment') is not null as installed", [], "bounded-read")).rows[0]?.installed)return '';
  return `,exists(select 1 from app.payment_checkout_intents i join app.payment_fulfillments f on f.intent_id=i.id
   where s.kind='specialist' and i.target_type=s.kind and i.target_id=s.id and i.owner_id=s.author_id and i.is_test
    and i.request_body::jsonb#>>'{metadata,publicationMode}'='specialist-account-test-v1'
    and f.published_at=s.published_at and f.expires_at=s.expires_at) as "testPublication"`;
 }
 private async listRows(kind:ServicePublicationKind,limit:number,offset:number){
  checkKind(kind);if(!Number.isSafeInteger(limit)||limit<1||limit>(kind==='marquee'?5:1000)||!Number.isSafeInteger(offset)||offset<0||offset>1000000||kind==='marquee'&&offset!==0)throw new ListingDraftInputError();
  const order=kind==='marquee'?'s.published_at,s.created_at,s.id':'s.published_at desc,s.created_at desc,s.id desc';
  const rows=(await this.db.query<PublicServiceRow>(`select ${columns}${this.identityColumn}${await this.specialistTestLabel(kind)} ${source} where ${live} and s.kind=$1 order by ${order} limit $2 offset $3`,[kind,limit,offset], "bounded-read")).rows;
  return rows;
 }
 list(kind:'specialist',limit?:number,offset?:number):Promise<SpecialistProfile[]>;
 list(kind:'fair',limit?:number,offset?:number):Promise<FairApplication[]>;
 list(kind:'marquee',limit?:number,offset?:number):Promise<PublicMarquee[]>;
 list(kind:ServicePublicationKind,limit?:number,offset?:number):Promise<PublicServiceMaterial[]>;
 async list(kind:ServicePublicationKind,limit=kind==='marquee'?5:24,offset=0):Promise<PublicServiceMaterial[]>{
  return (await this.listRows(kind,limit,offset)).map(row=>mapPublicServicePublication(row,Date.now())).filter((row):row is PublicServiceMaterial=>row!==null);
 }
 searchScope(){return{source,eligible:live,profileIdentity:this.options.specialistProfileIdentity===true};}
 async readMany(values:unknown[]):Promise<Array<SpecialistProfile|FairApplication>>{
  if(!Array.isArray(values)||values.length>25)throw new ListingDraftInputError();
  const ids=values.map(parseListingDraftId);if(new Set(ids).size!==ids.length)throw new ListingDraftInputError();if(!ids.length)return[];
  const rows=(await this.db.query<PublicServiceRow>(`select ${columns}${this.identityColumn}${await this.specialistTestLabel()} ${source}
   where s.id=any($1::uuid[]) and s.kind in ('specialist','fair') and ${live} limit 25`,[ids])).rows;
  return rows.map(row=>mapPublicServicePublication(row,Date.now())).filter((row):row is SpecialistProfile|FairApplication=>row!==null&&('profession'in row||'participantName'in row));
 }
 async sitemapPage(limit=100,offset=0){
  const rows=await this.listRows('specialist',limit,offset);
  const entries=rows.filter(row=>row.testPublication!==true).map(row=>mapPublicServicePublication(row,Date.now())).filter((row):row is SpecialistProfile=>row!==null&&'profession' in row)
   .map(({id,publishedAt})=>({id,publishedAt}));
  return{entries,hasMore:rows.length===limit};
 }
 async professionPage(professionId:unknown,limit=24,offset=0){
  const id=parseListingDraftId(professionId);
  if(!Number.isSafeInteger(limit)||limit<1||limit>100||!Number.isSafeInteger(offset)||offset<0||offset>1000000)throw new ListingDraftInputError();
  const rows=(await this.db.query<PublicServiceRow>(`select ${columns}${this.identityColumn}${await this.specialistTestLabel('specialist')} ${source}
   where ${live} and s.kind='specialist' and s.profession_id=$1 order by s.published_at desc,s.created_at desc,s.id desc limit $2 offset $3`,[id,limit+1,offset])).rows;
  return{items:rows.slice(0,limit).map(row=>mapPublicServicePublication(row,Date.now())).filter((row):row is SpecialistProfile=>row!==null&&'profession' in row),hasMore:rows.length>limit};
 }
 read(kind:'specialist',id:unknown):Promise<SpecialistProfile|undefined>;
 read(kind:'fair',id:unknown):Promise<FairApplication|undefined>;
 read(kind:'marquee',id:unknown):Promise<PublicMarquee|undefined>;
 read(kind:ServicePublicationKind,id:unknown):Promise<PublicServiceMaterial|undefined>;
 async read(kind:ServicePublicationKind,publication:unknown):Promise<PublicServiceMaterial|undefined>{
  checkKind(kind);let id:string;try{id=parseListingDraftId(publication);}catch{return undefined;}
  const row=(await this.db.query<PublicServiceRow>(`select ${columns}${this.identityColumn}${await this.specialistTestLabel(kind)} ${source} where ${live} and s.kind=$1 and s.id=$2 limit 1`,[kind,id])).rows[0];
  return row?mapPublicServicePublication(row,Date.now())??undefined:undefined;
 }
 async photoRecord(publication:unknown,file:unknown):Promise<{record:MediaFileRecord;revision:string;expiresAt:string}|undefined>{
  let id:string,media:string;try{id=parseListingDraftId(publication);media=parseListingDraftId(file);}catch{return undefined;}
  const row=(await this.db.query<PublicServiceRow&{record:MediaFileRecord;revision:string}>(`select ${columns},s.revision::text as revision,
   json_build_object('id',image.id,'mimeType',image.mime_type,'width',image.width,'height',image.height,'size',image.size,'sha256',image.sha256) as record
   ${source} join app.service_publication_photos attachment on attachment.publication_id=s.id
   join app.media_objects image on image.id=attachment.media_id and image.owner_id=s.author_id and image.state='ready'
   where ${live} and s.kind<>'marquee' ${this.options.specialistProfileIdentity?"and s.kind<>'specialist'":''} and s.id=$1 and image.id=$2 limit 1`,[id,media])).rows[0];
  if(!row||!mapPublicServicePublication(row,Date.now())||!row.mediaIds.includes(media))return undefined;
  return{record:row.record,revision:row.revision,expiresAt:row.expiresAt!};
 }
}
