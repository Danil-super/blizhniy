import {mediaOwnerByteLimit,mediaOwnerObjectLimit} from '../src/lib/media-upload-contract.ts';

const knownForeignReferences=['app.listing_photos.media_id','app.media_write_attempts.media_id','app.service_publication_photos.media_id','app.work_publication_photos.media_id'];
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const documents=`select 'work_form' source,form::text body from app.work_publications
 union all select 'service_form',form::text from app.service_publications
 union all select 'profile',profile::text from app.cabinet_profiles
 union all select 'listing_booking',booking::text from app.listings where booking is not null
 union all select 'application_snapshot',snapshot::text from app.applications
 union all select 'booking_snapshot',details_snapshot::text from app.booking_requests
 union all select 'payment_body',request_body::jsonb::text from app.payment_checkout_intents
 union all select 'refund_body',request_body::jsonb::text from app.payment_refund_requests`;
const referenceSources=['listing_photos','work_photos','service_photos','work_form','service_form','profile','listing_booking','application_snapshot','booking_snapshot','payment_body','refund_body'];
const check=value=>{if(!value)throw Error('MEDIA_INVENTORY_UNAVAILABLE');};

/** SQL observation only. A reference-free snapshot never grants filesystem or quota authority. */
export async function readMediaRetentionInventory(tx){
 try{
  const state=(await tx.query(`select current_setting('transaction_isolation') isolation,current_setting('transaction_read_only') as "readOnly",
   to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as "observedAt"`)).rows[0];
  check(state?.isolation==='repeatable read'&&state.readOnly==='on'&&typeof state.observedAt==='string'&&Number.isFinite(Date.parse(state.observedAt)));
  const foreign=(await tx.query(`select n.nspname||'.'||r.relname||'.'||a.attname source
   from pg_constraint c join pg_class r on r.oid=c.conrelid join pg_namespace n on n.oid=r.relnamespace
   cross join lateral unnest(c.conkey) k(attnum) join pg_attribute a on a.attrelid=r.oid and a.attnum=k.attnum
   where c.contype='f' and c.confrelid='app.media_objects'::regclass order by 1 limit 101`)).rows.map(row=>row.source);
  check(JSON.stringify(foreign)===JSON.stringify(knownForeignReferences));
  const documentBytes=(await tx.query(`with documents as (${documents}) select coalesce(sum(octet_length(body)),0)::text bytes from documents`)).rows[0]?.bytes;
  check(typeof documentBytes==='string'&&/^\d+$/.test(documentBytes)&&BigInt(documentBytes)<=BigInt(32*1024*1024));
  const rows=(await tx.query(`with documents as (${documents}), refs as (
    select media_id,'listing_photos' source from app.listing_photos
    union all select media_id,'work_photos' from app.work_publication_photos
    union all select media_id,'service_photos' from app.service_publication_photos
    union all select lower(found.hit[1])::uuid,source from documents
     cross join lateral regexp_matches(body,'[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}','gi') found(hit)
   ), grouped as (select media_id,array_agg(distinct source order by source) sources from refs group by media_id)
   select m.id,m.owner_id as "ownerId",m.state,m.size,exists(select 1 from app.media_write_attempts a where a.media_id=m.id) as "hasWriteAttempt",
    coalesce(g.sources,array[]::text[]) as references from app.media_objects m left join grouped g on g.media_id=m.id order by m.id limit 10001`)).rows;
  check(rows.length<=10000);const ids=new Set(),owners=new Map();let bytes=0,pendingWithAttempt=0,pendingWithoutAttempt=0,linked=0;
  const media=rows.map(row=>{
   check(uuid.test(row.id)&&uuid.test(row.ownerId)&&!ids.has(row.id)&&['pending','ready'].includes(row.state)&&Number.isInteger(row.size)&&row.size>=12&&row.size<=2097152&&typeof row.hasWriteAttempt==='boolean'&&Array.isArray(row.references)&&row.references.every(source=>referenceSources.includes(source)));
   ids.add(row.id);bytes+=row.size;if(row.references.length)linked++;
   if(row.state==='pending'){if(row.hasWriteAttempt)pendingWithAttempt++;else pendingWithoutAttempt++;}
   const owner=owners.get(row.ownerId)??{ownerId:row.ownerId,objects:0,bytes:0};owner.objects++;owner.bytes+=row.size;owners.set(row.ownerId,owner);
   return{id:row.id,ownerId:row.ownerId,state:row.state,size:row.size,hasWriteAttempt:row.hasWriteAttempt,references:row.references,unlinkedSince:null,action:'retain'};
  });
  const budget=(await tx.query('select charged_bytes::text as "chargedBytes",charged_objects as "chargedObjects" from app.media_storage_budget where singleton')).rows;
  check(budget.length===1&&budget[0].chargedBytes===String(bytes)&&budget[0].chargedObjects===rows.length);
  return{version:1,observedAt:state.observedAt,cleanupAuthorized:false,filesystem:'not-inspected',referenceCoverage:{sources:[...referenceSources],externalDocuments:'not-inspected',historicalVersions:'unavailable'},policy:{retentionDays:7,ownerBytes:mediaOwnerByteLimit,ownerObjects:mediaOwnerObjectLimit},
   summary:{objects:rows.length,bytes,ready:rows.length-pendingWithAttempt-pendingWithoutAttempt,pendingWithAttempt,pendingWithoutAttempt,linked,unlinked:rows.length-linked,accountingMatches:true,documentBytes:Number(documentBytes)},
   owners:[...owners.values()].map(owner=>({...owner,overQuota:owner.objects>mediaOwnerObjectLimit||owner.bytes>mediaOwnerByteLimit})),media};
 }catch{throw Error('MEDIA_INVENTORY_UNAVAILABLE');}
}
