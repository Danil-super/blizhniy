import {randomUUID} from 'node:crypto';
import type {PostgresDatabase,PostgresQueries} from './postgres';
import type {MediaFileRecord} from './media-files';
import type {createLocalMediaFileWorker} from './media-file-worker';

type RetirementCode='INVALID_MEDIA_RETIREMENT'|'MEDIA_RETIREMENT_DENIED'|'MEDIA_RETIREMENT_BUSY'|'MEDIA_RETIREMENT_UNAVAILABLE';
export class MediaRetirementError extends Error{
 constructor(readonly code:RetirementCode){super('Media retirement unavailable');this.name='MediaRetirementError';}
}
const fail=()=>new MediaRetirementError('MEDIA_RETIREMENT_UNAVAILABLE');
function local(){if(typeof window!=='undefined'||process.platform!=='linux'||process.env.NODE_ENV!=='test')throw fail();}
async function committed(tx:PostgresQueries){
 const row=(await tx.query<{isolation:string}>("select current_setting('transaction_isolation') as isolation")).rows[0];if(row?.isolation!=='read committed')throw fail();
}
type Claim={record:MediaFileRecord;attemptId:string|null;operationId:string};
/** Isolated candidate58 composition only. No HTTP, scheduler, retries or installed-role authority. */
export class LocalMediaRetirement{
 constructor(private readonly db:Pick<PostgresDatabase,'transaction'>,private readonly files:Pick<Awaited<ReturnType<typeof createLocalMediaFileWorker>>,'retire'>){local();}
 async retire(id:string,signal?:AbortSignal):Promise<{id:string;operationId:string;status:'completed'}>{
  local();if(typeof id!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(id))throw new MediaRetirementError('INVALID_MEDIA_RETIREMENT');
  try{
   const claim=await this.files.retire(()=>this.db.transaction(async tx=>{
    await committed(tx);
    const record=(await tx.query<MediaFileRecord>(`select id,mime_type as "mimeType",width,height,size,sha256 from app.media_objects where id=$1 for no key update`,[id])).rows[0];
    if(!record)throw new MediaRetirementError('MEDIA_RETIREMENT_DENIED');
    const existing=(await tx.query<{operationId:string}>('select operation_id as "operationId" from app.media_retirement_requests where media_id=$1',[id])).rows[0];
    const operationId=existing?.operationId??randomUUID();
    if(!existing)await tx.query('insert into app.media_retirement_requests(media_id,operation_id) values($1,$2)',[id,operationId]);
    const attempt=(await tx.query<{id:string}>('select id from app.media_write_attempts where media_id=$1',[id])).rows[0];
    return{record,attemptId:attempt?.id??null,operationId} satisfies Claim;
   }),signal);
   // Durable absence survives child close: terminal identity forbids all future guarded writers.
   // An unknown COMMIT may already have released accounting; never compensate or retry here.
   await this.db.transaction(async tx=>{
    await committed(tx);await tx.query('insert into app.media_retirement_completions(media_id,operation_id) values($1,$2) on conflict(media_id) do nothing',[id,claim.operationId]);
   });
   return{id,operationId:claim.operationId,status:'completed'};
  }catch(error){
   if(error instanceof MediaRetirementError)throw error;
   const code=error&&typeof error==='object'&&'code'in error?error.code:null;
   throw new MediaRetirementError(code==='MRJ02'?'MEDIA_RETIREMENT_DENIED':code==='MEDIA_FILE_WORKER_BUSY'?'MEDIA_RETIREMENT_BUSY':'MEDIA_RETIREMENT_UNAVAILABLE');
  }
 }
}
