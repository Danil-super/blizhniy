import {PostgresServicePublicationStore,ServicePublicationAccessError,ServicePublicationConflictError} from './postgres-service-publications';
import type {PostgresDatabase,PostgresQueries} from './postgres';
/** The caller holds the user lock; SQL purchase triggers also lock and recheck references. */
export async function inspectSpecialistPurchase(db:Pick<PostgresDatabase,'transaction'>,tx:PostgresQueries,owner:string,id:string,revision:string,lockReferences=true){
 const row=(await tx.query<{revision:string;city:string|null;profession:string|null}>(`select revision::text,city_id as city,profession_id as profession from app.service_publications
  where id=$1 and author_id=$2 and kind='specialist' and deleted_at is null for update`,[id,owner])).rows[0];
 if(!row)throw new ServicePublicationAccessError();if(row.revision!==revision)throw new ServicePublicationConflictError();
 const lock=lockReferences?' for share':'';
 const city=(await tx.query<{name:string}>(`select name from app.cities where id=$1${lock}`,[row.city])).rows[0];
 const profession=(await tx.query<{active:boolean}>(`select active from app.specialist_categories where id=$1${lock}`,[row.profession])).rows[0];
 const profile=(await tx.query<{name:string}>("select profile->>'name' as name from app.cabinet_profiles where user_id=$1 for share",[owner])).rows[0];
 const {snapshot,issues}=await new PostgresServicePublicationStore(db,{specialistProfileIdentity:true}).inspectInTransaction(tx,owner,'specialist',id,revision,true);
 if(!snapshot.canRepeat&&(snapshot.status!=='draft'||snapshot.paid||snapshot.publishedAt!==null||snapshot.expiresAt!==null))issues.push('Анкета сейчас недоступна для оплаты.');
 if(snapshot.form.kind!=='specialist')throw new ServicePublicationAccessError();
 if(city?.name!==snapshot.form.cityName||!profession?.active||!profile?.name||profile.name!==snapshot.form.title)issues.push('Данные профиля, города или профессии изменились. Сохраните анкету заново.');
 if(snapshot.form.photoIds.length||snapshot.form.skills!==null||snapshot.form.experience!==null)issues.push('Сохраните анкету в текущем формате с единым полем «О себе».');
 if(!(await tx.query('select app.phone_is_confirmed($1) ready',[owner])).rows[0]?.ready)issues.push('Подтвердите телефон.');
 if((await tx.query("select id from app.service_moderation where publication_id=$1 and revision=$2::bigint and state='approved' for share",[id,revision])).rowCount!==1)issues.push('Дождитесь одобрения текущей версии анкеты.');
 return{snapshot,issues};
}
