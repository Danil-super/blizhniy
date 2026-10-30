import {withAppSessionTransaction} from './app-session-transaction';
import {WorkPublicationAccessError} from './postgres-work-publications';
import {parseListingDraftId,parseListingDraftCursor} from './listing-draft-contract.ts';
import {parseWorkCabinetPage,type WorkCabinetItem} from './work-cabinet-contract.ts';
import {readPostmoderationEnabled} from './listing-workflow-config';
import type {WorkPublicationKind} from './work-publication-contract';
import type {PostgresDatabase} from './postgres';
import {effectivePublicationStatusSql} from './publication-effective-status';

/** Separate bounded read model: no changed write contract, new privileges or per-card SQL round trips. */
export class PostgresWorkCabinetStore{
 constructor(private readonly db:Pick<PostgresDatabase,'transaction'>){if(typeof window!=='undefined')throw Error('Work cabinet storage is server-only');}
 list(token:string,expectedOwner:string,kind:WorkPublicationKind,after:unknown){
  const owner=parseListingDraftId(expectedOwner),cursor=parseListingDraftCursor(after);
  if(kind!=='vacancy'&&kind!=='workRequest')throw new WorkPublicationAccessError();
  return withAppSessionTransaction(this.db,token,async(tx,user)=>{
   if(user.id!==owner)throw new WorkPublicationAccessError();
   const effective=effectivePublicationStatusSql('w');
   const status=readPostmoderationEnabled()&&kind==='workRequest'?`case when exists(select 1 from app.applications chosen where chosen.work_publication_id=w.id and chosen.status='selected' and chosen.is_paid and chosen.sent_at is not null) then 'assigned' else ${effective} end`:effective;
   const rows=(await tx.query<WorkCabinetItem>(`select w.id,w.kind,w.revision::text as revision,${status} as status,w.is_paid as paid,w.title,
    to_char(w.updated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "updatedAt",
    w.form->>(case when w.kind='vacancy' then 'salary' else 'budget' end) as amount,
    w.form->>'organization' as organization,w.form->>'cityName' as city,w.form->>'district' as district,
    w.form->>'professionName' as profession,w.form->>'schedule' as schedule,w.form->>'workFormat' as "workFormat",
    photo.id as "coverPhotoId" from app.work_publications w
    left join lateral(select m.id from app.work_publication_photos p join app.media_objects m on m.id=p.media_id
     where p.publication_id=w.id and m.owner_id=w.author_id and m.state='ready' order by p.position limit 1) photo on true
    where w.author_id=$1 and w.kind=$2 and w.deleted_at is null ${cursor?'and (w.updated_at,w.id)<($3::timestamptz,$4::uuid)':''}
    order by w.updated_at desc,w.id desc limit 21`,cursor?[owner,kind,cursor.updatedAt,cursor.id]:[owner,kind])).rows;
   const items=rows.slice(0,20),last=items.at(-1);
   return parseWorkCabinetPage({items,nextCursor:rows.length>20&&last?{id:last.id,updatedAt:last.updatedAt}:null},kind);
  });
 }
}
