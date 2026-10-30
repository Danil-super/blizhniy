import {PostgresWorkPublicationStore,WorkPublicationAccessError,WorkPublicationConflictError} from './postgres-work-publications';
import {checkWorkCheckoutForm} from './work-checkout-validation';
import type {WorkPublicationKind} from './work-publication-contract';
import type {PostgresDatabase,PostgresQueries} from './postgres';
/** User is already locked by session/worker. Hold references through the final write. */
export async function inspectWorkPurchase(db:Pick<PostgresDatabase,'transaction'>,tx:PostgresQueries,owner:string,id:string,revision:string,kind:WorkPublicationKind,lockReferences=true){
 const row=(await tx.query<{revision:string;city:string|null;profession:string|null}>(`select revision::text,city_id as city,profession_id as profession
  from app.work_publications where id=$1 and author_id=$2 and kind=$3 and deleted_at is null for update`,[id,owner,kind])).rows[0];
 if(!row)throw new WorkPublicationAccessError();if(row.revision!==revision)throw new WorkPublicationConflictError();
 if(kind==='workRequest'&&(await tx.query("select id from app.applications where work_publication_id=$1 and status='selected' and is_paid and sent_at is not null",[id])).rowCount)throw new WorkPublicationConflictError();
 const lock=lockReferences?' for share':'';
 const city=(await tx.query<{name:string}>(`select name from app.cities where id=$1${lock}`,[row.city])).rows[0];
 const profession=(await tx.query<{name:string;active:boolean}>(`select name,active from app.specialist_categories where id=$1${lock}`,[row.profession])).rows[0];
 if(lockReferences)await tx.query(`select m.id from app.media_objects m join app.work_publication_photos p on p.media_id=m.id
  where p.publication_id=$1 order by m.id limit 21 for share of m`,[id]);
 const {snapshot,issues}=await new PostgresWorkPublicationStore(db).inspectInTransaction(tx,owner,kind,id,revision);
 if(snapshot.status!=='draft'||snapshot.paid||snapshot.publishedAt||snapshot.expiresAt)issues.push('Публикация уже не является неоплаченным черновиком.');
 if(city?.name!==snapshot.form.cityName||!profession?.active)issues.push('Город или профессия изменились. Выберите их заново.');
 issues.push(...checkWorkCheckoutForm(snapshot.form));
 return {snapshot,issues};
}
