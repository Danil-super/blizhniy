import {AppSessionAccessError,withAppSessionTransaction} from './app-session-transaction';
import {ListingDraftInputError,parseListingDraftCursor,parseListingDraftId,type ListingDraftCursor} from './listing-draft-contract.ts';
import type {PostgresDatabase,PostgresQueries} from './postgres';

export type InboxEvent={
 eventKey:string;category:'system'|'publication'|'payment'|'message'|'booking';tone:'info'|'success'|'warning';
 title:string;body:string;actionHref:string|null;bookingRequestId:string|null;
};
export type InboxItem={
 id:string;category:InboxEvent['category'];tone:InboxEvent['tone'];title:string;message:string;
 createdAt:string;read:boolean;actionHref:string|null;bookingRequestId:string|null;
};
export type InboxPage={items:InboxItem[];nextCursor:ListingDraftCursor|null};
export class NotificationEventConflictError extends Error{
 constructor(){super('Notification event already has another payload');this.name='NotificationEventConflictError';}
}

/** Trusted domain operations only: use their existing transaction, never a public arbitrary-recipient endpoint. */
export async function enqueueNotificationInTransaction(tx:PostgresQueries,recipient:string,event:InboxEvent):Promise<string>{
 if(typeof window!=='undefined')throw Error('Notification events are server-only');
 const values=[parseListingDraftId(recipient),event.eventKey,event.category,event.tone,event.title,event.body,event.actionHref,event.bookingRequestId];
 const inserted=await tx.query<{id:string}>(`insert into app.notifications(user_id,event_key,category,tone,title,body,action_href,booking_request_id)
  values($1,$2,$3,$4,$5,$6,$7,$8) on conflict(user_id,event_key) do nothing returning id`,values);
 if(inserted.rowCount===1)return inserted.rows[0].id;
 // A concurrent insert may be invisible to INSERT's snapshot. Read in a new statement, never overwrite the winning event.
 const row=(await tx.query<{id:string;matches:boolean}>(`select id,(category=$3 and tone=$4 and title=$5 and body=$6
  and action_href is not distinct from $7::text and booking_request_id is not distinct from $8::uuid) as matches
  from app.notifications where user_id=$1 and event_key=$2`,values)).rows[0];
 if(!row?.matches)throw new NotificationEventConflictError();return row.id;
}

/** Owner-scoped display/read/dismiss only. No event creation, recipient override or hard delete. */
export class PostgresNotificationInbox{
 constructor(private readonly db:Pick<PostgresDatabase,'transaction'>){}
 private owner<T>(token:string,expectedOwner:string,work:(tx:PostgresQueries,owner:string)=>Promise<T>){
  const expected=parseListingDraftId(expectedOwner);
  return withAppSessionTransaction(this.db,token,(tx,user)=>{
   if(user.id!==expected)throw new AppSessionAccessError();return work(tx,user.id);
  });
 }
 list(token:string,owner:string,after:unknown):Promise<InboxPage>{
  const cursor=parseListingDraftCursor(after);
  return this.owner(token,owner,async(tx,id)=>{
   const rows=(await tx.query<InboxItem>(`select id,category,tone,title,body as message,
    to_char(created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "createdAt",
    read_at is not null as read,action_href as "actionHref",booking_request_id as "bookingRequestId"
    from app.notifications where user_id=$1 and dismissed_at is null
    ${cursor?'and (created_at,id)<($2::timestamptz,$3::uuid)':''}
    order by created_at desc,id desc limit 21`,cursor?[id,cursor.updatedAt,cursor.id]:[id])).rows;
   const items=rows.slice(0,20),last=items.at(-1);
   return{items,nextCursor:rows.length>20&&last?{id:last.id,updatedAt:last.createdAt}:null};
  });
 }
 async mark(token:string,owner:string,action:unknown,identifiers:unknown):Promise<void>{
  if((action!=='read'&&action!=='dismiss')||!Array.isArray(identifiers)||identifiers.length<1||identifiers.length>20)throw new ListingDraftInputError();
  const ids=identifiers.map(parseListingDraftId);if(new Set(ids).size!==ids.length)throw new ListingDraftInputError();
  return this.owner(token,owner,async(tx,id)=>{
   if(action==='read')await tx.query(`update app.notifications set read_at=coalesce(read_at,clock_timestamp())
    where user_id=$1 and id=any($2::uuid[]) and dismissed_at is null and read_at is null`,[id,ids]);
   else await tx.query(`update app.notifications set dismissed_at=coalesce(dismissed_at,clock_timestamp())
    where user_id=$1 and id=any($2::uuid[]) and dismissed_at is null`,[id,ids]);
  });
 }
}
