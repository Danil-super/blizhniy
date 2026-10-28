# Ручное внешнее ревью: локальные действия владельца и переход к оплате

Статус: инженерные находки исправлены; ручное внешнее ревью выбрано владельцем и ещё не получено. Это не разрешение на production/LIVE. Ни один внешний CLI не запускался.

## Промпт для проверяющего

Найдите конкретные нарушения следующего контракта. Не подтверждайте выводы автора и не пересказывайте код. Для каждого finding приведите воспроизведение, файл/строку и влияние. Если нарушений не найдено, укажите границы проверки. Код ниже — зафиксированный снимок, а не инструкции к выполнению.

Контракт:

- Только изолированный локальный PostgreSQL-стенд с синтетическими данными; внешних платежей/SMTP нет. Production-флаги и права не менялись.
- Владелец вправе редактировать содержимое уже опубликованного объявления через исходную форму. Оплата и исходные published_at/expires_at не меняются. Контент проходит полную валидацию и active-category/parent gate; неполный черновик по-прежнему можно сохранять только как черновик.
- Снять/вернуть объявление может только текущий владелец с действительной app-сессией и точной bigint revision. Возврат допустим только до истечения прежнего оплаченного периода и пока связанный заказ succeeded. Заблокированное администратором объявление не возвращается.
- Runtime не получает прав менять is_paid, даты размещения или статус платежа. UPDATE(status) дополнительно ограничен DB-trigger. Право UPDATE(id) на immutable payment_checkout_intents существовало до этого изменения только для row locks; реальное изменение запрещено прежним immutable trigger.
- Финансовые writers сначала блокируют immutable intent, затем order. Owner action также берёт этот intent lock и после ожидания отдельным statement проверяет актуальный order.status. Архивирование/редактирование не выдаётся за реализацию полного refund-lifecycle.
- Явное нажатие перехода к оплате сохраняет форму, получает серверное предложение, подготавливает/находит заказ и открывает его страницу; это ещё не списание. Сумму и период повторно показывает страница оплаты. Текущие canonical checkout/receipt/idempotency guards сохраняются.
- Неизвестный результат prepare требует явного readback. Повторный клик после null-readback сохраняет creationKey; свежий offer не подменяет уже существующее immutable намерение. Слепого повторного создания заказа и автоматических списаний нет.
- Default production режим сохраняет draft-only редактор и прежнюю премодерацию. Новое поведение включается только валидированным локальным postmoderation флагом.

Проверки: native regression; tests/listing-owner-actions*.mjs, listing-published-edit.test.mjs, listing-payment-start.test.mjs; scripts/check-local-owner-actions.mjs с SET LOCAL ROLE blizhniy_runtime; scripts/check-local-listing-ui.mjs (реальный браузер и локальный симулятор). Вывод reviewer не заменяет испытание реальной ЮKassa.

## Хеши снимка SHA-256

```text
2392ee037bf2a0b8299cdcb132060f9f8bcc43aeb068fa3fb7058dc621fbd15d  database/migrations/0027-listing-owner-visibility.sql
f8289025a041dcab70d861dd4b21c739c94b60475f9fb801c0fb8b6be41a54ee  database/migrations/0028-listing-restore-entitlement.sql
d12c94206a5e56c818842402bc15c2e0d62305f328db2010a1104f7efdb137fd  src/lib/postgres-listing-owner-actions.ts
3bd717456ad8b60d56374cfafce62c77a53c604682d9c4a1d01204497a89eaf4  src/lib/listing-owner-actions-http.ts
440fe0e62d1beac577238812820a55219ffe310650ee188a47b639d0bb3c66f9  src/lib/postgres-listing-form.ts
3172648c435fbb8571ca7eeafd7c1e54fa67938e8e8072009e2b6a9c97bc19e9  src/lib/listing-payment-start.ts
88063852699f864e744a8744f87753396a3b4e016da5d751d18c3fca39cf05cd  src/components/listings/PrimaryListingFormButton.tsx
1e761514f49590716c822f8ff4e5d1c8c359ec0811343ddb53d048df2a5c5c2a  src/lib/app-session-transaction.ts
88b3096149eb2222fb1f3f18cc211326d22b4c2ae41b912553ad6b215afcc74e  database/permissions/listing-checkout-dispatch.sql
```

## Код

### database/migrations/0027-listing-owner-visibility.sql

```sql
-- Local opt-in only. UPDATE(status) is useful only for a paid, unexpired
-- published<->archived transition. It cannot mint a payment or extend a period.
begin;
set local lock_timeout='3s';
set local statement_timeout='10s';
create function app.guard_listing_owner_visibility() returns trigger language plpgsql
set search_path=pg_catalog,app as $$
begin
 if current_user='blizhniy_runtime' and new.status is distinct from old.status then
  if old.status not in ('published','archived') or new.status not in ('published','archived')
   or not old.is_paid or old.published_at is null or old.expires_at is null
   or old.published_at>clock_timestamp() or old.expires_at<=clock_timestamp()
   or new.revision<>old.revision+1
   or (to_jsonb(new)-array['status','revision','updated_at']) is distinct from (to_jsonb(old)-array['status','revision','updated_at'])
   or exists(select 1 from app.listing_blocks b where b.listing_id=old.id)
   or not exists(select 1 from app.payment_checkout_intents i join app.payment_fulfillments f on f.intent_id=i.id
     where i.target_type='listing' and i.target_id=old.id and i.owner_id=old.author_id
      and f.published_at=old.published_at and f.expires_at=old.expires_at)
  then raise exception 'Listing visibility transition denied' using errcode='42501';end if;
 end if;
 return new;
end;
$$;
revoke all on function app.guard_listing_owner_visibility() from public;
create trigger listing_owner_visibility_guard before update on app.listings
for each row execute function app.guard_listing_owner_visibility();
commit;
```

### database/migrations/0028-listing-restore-entitlement.sql

```sql
-- Follow-up to local0027: historical fulfillment does not authorize restoring a refunded order.
begin;
set local lock_timeout='3s';
set local statement_timeout='10s';
create or replace function app.guard_listing_owner_visibility() returns trigger language plpgsql
set search_path=pg_catalog,app as $$
begin
 if current_user='blizhniy_runtime' and new.status is distinct from old.status then
  if old.status not in ('published','archived') or new.status not in ('published','archived')
   or not old.is_paid or old.published_at is null or old.expires_at is null
   or old.published_at>clock_timestamp() or old.expires_at<=clock_timestamp()
   or new.revision<>old.revision+1
   or (to_jsonb(new)-array['status','revision','updated_at']) is distinct from (to_jsonb(old)-array['status','revision','updated_at'])
   or exists(select 1 from app.listing_blocks b where b.listing_id=old.id)
   or not exists(select 1 from app.payment_checkout_intents i join app.payment_fulfillments f on f.intent_id=i.id
     join app.payment_orders p on p.id=i.id
     where i.target_type='listing' and i.target_id=old.id and i.owner_id=old.author_id
      and f.published_at=old.published_at and f.expires_at=old.expires_at
      and (new.status='archived' or p.status='succeeded'))
  then raise exception 'Listing visibility transition denied' using errcode='42501';end if;
 end if;
 return new;
end;
$$;
revoke all on function app.guard_listing_owner_visibility() from public;
commit;
```

### src/lib/postgres-listing-owner-actions.ts

```typescript
import {withAppSessionTransaction} from './app-session-transaction';
import {ListingDraftAccessError,ListingDraftConflictError} from './postgres-listing-drafts';
import {parseListingDraftId,parseListingDraftRevision,ListingDraftInputError} from './listing-draft-contract.ts';
import type {PostgresDatabase} from './postgres';
export class PostgresListingOwnerActions {
 constructor(private readonly db:Pick<PostgresDatabase,'transaction'>){}
 async change(token:string,owner:string,value:unknown,expected:unknown,action:unknown){
  const id=parseListingDraftId(value),revision=parseListingDraftRevision(expected);
  if(action!=='withdraw'&&action!=='restore')throw new ListingDraftInputError();
  return withAppSessionTransaction(this.db,token,async(tx,user)=>{
   if(user.id!==owner)throw new ListingDraftAccessError();
   // Match financial writers: immutable intent before the listing. Re-read the
   // order after acquiring that lock; a pre-wait snapshot may predate a refund.
   const payments=(await tx.query<{id:string}>(`select i.id from app.payment_checkout_intents i
    join app.payment_fulfillments f on f.intent_id=i.id join app.listings l on l.id=i.target_id and l.author_id=i.owner_id
    where i.target_type='listing' and i.target_id=$1 and i.owner_id=$2 and f.published_at=l.published_at and f.expires_at=l.expires_at
    order by i.id limit 2 for update of i`,[id,owner])).rows;
   if(payments.length!==1)throw new ListingDraftAccessError();
   const payment=(await tx.query<{status:string}>('select status from app.payment_orders where id=$1',[payments[0].id])).rows[0];
   if(!payment||(action==='restore'&&payment.status!=='succeeded'))throw new ListingDraftAccessError();
   const row=(await tx.query<{id:string;revision:string;status:string;live:boolean;blocked:boolean}>(`select id,revision::text,status,
    (is_paid and published_at<=clock_timestamp() and expires_at>clock_timestamp()) as live,
    exists(select 1 from app.listing_blocks b where b.listing_id=l.id) as blocked
    from app.listings l where id=$1 and author_id=$2 for update`,[id,owner])).rows[0];
   if(!row||row.blocked||!row.live||!['published','archived'].includes(row.status))throw new ListingDraftAccessError();
   if(row.revision!==revision||revision==='9223372036854775807')throw new ListingDraftConflictError();
   const status=action==='withdraw'?'archived':'published';
   if(row.status===status)return{id,revision,status};
   const result=await tx.query<{id:string;revision:string;status:string}>(`update app.listings set status=$4,revision=revision+1,updated_at=clock_timestamp()
    where id=$1 and author_id=$2 and revision=$3::bigint returning id,revision::text,status`,[id,owner,revision,status]);
   if(result.rowCount!==1)throw new ListingDraftConflictError();
   return result.rows[0];
  });
 }
}
```

### src/lib/listing-owner-actions-http.ts

```typescript
import {authJson,readAuthJson,AuthRequestError,type AuthRateLimiter} from './auth-http';
import {readAccountSessionToken} from './account-cookie';
import {getTrustedProxyIp} from './trusted-proxy-ip';
import {AppSessionAccessError} from './app-session-transaction';
import {ListingDraftAccessError,ListingDraftConflictError} from './postgres-listing-drafts';
import {parseListingDraftId,parseListingDraftRevision,ListingDraftInputError} from './listing-draft-contract.ts';
import type {PostgresListingOwnerActions} from './postgres-listing-owner-actions';
type Runtime={store:Pick<PostgresListingOwnerActions,'change'>;limiter:Pick<AuthRateLimiter,'allowProduction'>};
export function createListingOwnerActionsHandler(config:{origin:string},getRuntime:()=>Promise<Runtime>){return async(request:Request)=>{
 try{
  if(request.method!=='POST')return authJson({error:{code:'METHOD_NOT_ALLOWED'}},405,{Allow:'POST'});
  const raw=await readAuthJson(request,config,2000,'POST',4096);
  if(!raw||typeof raw!=='object'||Array.isArray(raw)||Object.keys(raw).sort().join()!=='action,expectedOwnerId,expectedRevision,listingId')throw new AuthRequestError(422,'INVALID_INPUT');
  const row=raw as Record<string,unknown>,owner=parseListingDraftId(row.expectedOwnerId),id=parseListingDraftId(row.listingId),revision=parseListingDraftRevision(row.expectedRevision);
  if(row.action!=='withdraw'&&row.action!=='restore')throw new AuthRequestError(422,'INVALID_INPUT');
  const ip=getTrustedProxyIp(request.headers),token=readAccountSessionToken(request);
  if(!ip)throw new AuthRequestError(403,'UNTRUSTED_INGRESS');if(!token)throw new AuthRequestError(401,'UNAUTHENTICATED');
  const runtime=await getRuntime();if(!await runtime.limiter.allowProduction('session',ip))throw new AuthRequestError(429,'RATE_LIMITED');
  return authJson(await runtime.store.change(token,owner,id,revision,row.action),200);
 }catch(error){
  const status=error instanceof AuthRequestError?error.status:error instanceof AppSessionAccessError?401:error instanceof ListingDraftAccessError?404:error instanceof ListingDraftConflictError?409:error instanceof ListingDraftInputError?422:503;
  const code=error instanceof AuthRequestError?error.code:status===401?'UNAUTHENTICATED':status===404?'DRAFT_NOT_FOUND':status===409?'DRAFT_CHANGED':status===422?'INVALID_INPUT':'ACTION_UNAVAILABLE';
  return authJson({error:{code}},status,status===429?{'Retry-After':'900'}:undefined);
 }
};}
```

### src/lib/postgres-listing-form.ts

```typescript
import {withAppSessionTransaction} from './app-session-transaction';
import {ListingDraftAccessError,ListingDraftConflictError} from './postgres-listing-drafts';
import {ListingDraftInputError,parseListingDraftId,parseListingDraftRevision} from './listing-draft-contract.ts';
import {parseListingFormDraft,type ListingFormDraft,type ListingFormSnapshot} from './listing-form-contract.ts';
import {maxListingMediaTotalSize} from './media-limits.ts';
import type {PostgresDatabase,PostgresQueries} from './postgres';
import type {ListingDraftPhoto} from './listing-photo-contract';
import {checkListingPublication,checkListingFormContent,type PublicationTariffRow} from './listing-publication-check';
const kinds={sell:'prodam',buy:'kuplyu',free:'otdam-darom',rent:'arenda'} as const;
const dbKinds={prodam:'sell',kuplyu:'buy','otdam-darom':'free',arenda:'rent'} as const;
type Row=ListingFormDraft&{id:string;revision:string;listingType:keyof typeof kinds};
const columns=`l.id,l.revision::text as revision,l.listing_type as "listingType",l.title,l.description,l.price::text as price,
 coalesce(parent.slug,c.slug) as "categorySlug",case when c.parent_id is not null then c.name end as "subcategoryName",city.name as "cityName",
 l.district,l.address,l.latitude::float8 as latitude,l.longitude::float8 as longitude,l.show_exact_address as "showExactAddress",
 l.contact_phone as "contactPhone",l.messenger_url as "messengerUrl",l.booking`;

/** Full owner-private draft replacement. No publication, billing writes, public view or retry. */
export class PostgresListingFormStore{
 private readonly contactMethod:boolean;
 private readonly editableStatus:string;
 constructor(private readonly db:Pick<PostgresDatabase,'transaction'>,options:{contactMethod?:boolean;postmoderation?:boolean}={}){
  if(typeof window!=='undefined'||(options.contactMethod!==undefined&&typeof options.contactMethod!=='boolean'))throw new Error('Listing forms are server-only');
  this.contactMethod=options.contactMethod===true;
  this.editableStatus=options.postmoderation===true?"l.status in ('draft','published','archived')":"l.status='draft'";
 }
 private async snapshot(tx:PostgresQueries,owner:string,id:string):Promise<ListingFormSnapshot>{
  const row=(await tx.query<Row>(`select ${columns}${this.contactMethod?',l.contact_method as "contactMethod"':''} from app.listings l left join app.categories c on c.id=l.category_id
   left join app.categories parent on parent.id=c.parent_id left join app.cities city on city.id=l.city_id
   where l.id=$1 and l.author_id=$2 and ${this.editableStatus}`,[id,owner])).rows[0];
  if(!row)throw new ListingDraftAccessError();
  const photos=(await tx.query<ListingDraftPhoto&{permitted:boolean}>(`select m.id,m.mime_type as "mimeType",m.width,m.height,m.size,
   (m.owner_id=$2 and m.state='ready') as permitted from app.listing_photos p join app.media_objects m on m.id=p.media_id
   where p.listing_id=$1 order by p.position limit 10001`,[id,owner])).rows;
  if(photos.length>10000||photos.some(item=>!item.permitted)||photos.reduce((sum,item)=>sum+item.size,0)>maxListingMediaTotalSize)throw new ListingDraftAccessError();
  const {id:listingId,revision,listingType,...fields}=row;
  return{id:listingId,revision,form:parseListingFormDraft({...fields,kind:kinds[listingType],photoIds:photos.map(item=>item.id)}),
   photos:photos.map(({id,mimeType,width,height,size})=>({id,mimeType,width,height,size}))};
 }
 read(token:string,owner:string,listingId:unknown){return withAppSessionTransaction(this.db,token,async(tx,user)=>{
  if(user.id!==owner)throw new ListingDraftAccessError();return this.snapshot(tx,owner,parseListingDraftId(listingId));
 });}
 readEditable(token:string,owner:string,listingId:unknown){return withAppSessionTransaction(this.db,token,async(tx,user)=>{
  if(user.id!==owner)throw new ListingDraftAccessError();const id=parseListingDraftId(listingId);
  const row=(await tx.query<{status:string}>(`select l.status from app.listings l where l.id=$1 and l.author_id=$2 and ${this.editableStatus} for update`,[id,owner])).rows[0];
  if(!row)throw new ListingDraftAccessError();return{snapshot:await this.snapshot(tx,owner,id),placed:row.status!=='draft'};
 });}
 checkPublication(token:string,owner:string,listingId:unknown,expectedRevision:unknown){return withAppSessionTransaction(this.db,token,async(tx,user)=>{
  if(user.id!==owner)throw new ListingDraftAccessError();return (await this.inspectInTransaction(tx,owner,listingId,expectedRevision)).check;
 });}
 /** Trusted repository composition only: caller must authorize identity and hold the app-session transaction. */
 async inspectInTransaction(tx:PostgresQueries,owner:string,listingId:unknown,expectedRevision:unknown){
  const id=parseListingDraftId(listingId),revision=parseListingDraftRevision(expectedRevision);
  const current=(await tx.query<{revision:string}>("select revision::text as revision from app.listings where id=$1 and author_id=$2 and status='draft' for update",[id,owner])).rows[0];
  if(!current)throw new ListingDraftAccessError();if(current.revision!==revision)throw new ListingDraftConflictError();
  const snapshot=await this.snapshot(tx,owner,id);
  const category=(await tx.query<{active:boolean}>(`select (c.active and (c.parent_id is null or parent.active is true)) as active
   from app.listings l join app.categories c on c.id=l.category_id left join app.categories parent on parent.id=c.parent_id where l.id=$1`,[id])).rows[0];
  const offer=(await tx.query<PublicationTariffRow>(`select id,action,name,price::text as amount,duration_days as "durationDays",active
   from app.tariffs where action='listing_publication' limit 1`)).rows[0]??null;
  return {snapshot,check:checkListingPublication(snapshot,category?.active===true,offer)};
 }
 async update(token:string,owner:string,listingId:unknown,expectedRevision:unknown,input:unknown){
  try{return await withAppSessionTransaction(this.db,token,async(tx,user)=>{
   if(user.id!==owner)throw new ListingDraftAccessError();
   const id=parseListingDraftId(listingId),revision=parseListingDraftRevision(expectedRevision),form=parseListingFormDraft(input);
   if(form.contactMethod==='messenger'&&!this.contactMethod)throw new ListingDraftInputError();
   const current=(await tx.query<{revision:string;status:string}>(`select l.revision::text as revision,l.status from app.listings l where l.id=$1 and l.author_id=$2 and ${this.editableStatus} for update`,[id,owner])).rows[0];
   if(!current)throw new ListingDraftAccessError();if(current.revision!==revision||revision==='9223372036854775807')throw new ListingDraftConflictError();
   if(current.status!=='draft'&&checkListingFormContent(form,true).length)throw new ListingDraftInputError();
   let categoryId:string|null=null,cityId:string|null=null;
   if(form.categorySlug){
    const categories=(await tx.query<{id:string;active:boolean}>(`select c.id,(c.active and root.active) as active from app.categories root join app.categories c
     on (case when $2::text is null then c.id=root.id else c.parent_id=root.id and c.name=$2 end)
     where root.slug=$1 and root.parent_id is null limit 2`,[form.categorySlug,form.subcategoryName])).rows;
    if(categories.length!==1||(current.status!=='draft'&&!categories[0].active))throw new ListingDraftInputError();categoryId=categories[0].id;
   }
   if(form.cityName){const cities=(await tx.query<{id:string}>('select id from app.cities where name=$1 limit 2',[form.cityName])).rows;
    if(cities.length!==1)throw new ListingDraftInputError();cityId=cities[0].id;}
   const available=form.photoIds.length?(await tx.query<{size:number}>("select size from app.media_objects where owner_id=$1 and state='ready' and id=any($2::uuid[])",[owner,form.photoIds])).rows:[];
   if(available.length!==form.photoIds.length)throw new ListingDraftAccessError();
   if(available.reduce((sum,item)=>sum+item.size,0)>maxListingMediaTotalSize)throw new ListingDraftInputError();
   const updated=await tx.query(`update app.listings set listing_type=$3,title=$4,description=$5,price=$6,category_id=$7,city_id=$8,
    district=$9,address=$10,latitude=$11,longitude=$12,show_exact_address=$13,contact_phone=$14,messenger_url=$15,booking=$16::jsonb,${this.contactMethod?'contact_method=$18,':''}
    revision=revision+1,updated_at=clock_timestamp() where id=$1 and author_id=$2 and ${this.editableStatus.replaceAll('l.','')} and revision=$17::bigint`,
    [id,owner,dbKinds[form.kind],form.title,form.description,form.price,categoryId,cityId,form.district,form.address,form.latitude,form.longitude,
     form.showExactAddress,form.contactPhone,form.messengerUrl,form.booking===null?null:JSON.stringify(form.booking),revision,...(this.contactMethod?[form.contactMethod??'phone']:[])]);
   if(updated.rowCount!==1)throw new ListingDraftConflictError();
   await tx.query('delete from app.listing_photos where listing_id=$1',[id]);
   if(form.photoIds.length)await tx.query(`insert into app.listing_photos(listing_id,media_id,position)
    select $1,item.id,(item.position-1)::integer from unnest($2::uuid[]) with ordinality as item(id,position)`,[id,form.photoIds]);
   return this.snapshot(tx,owner,id);
  });}catch(error){if(error&&typeof error==='object'&&'code'in error&&error.code==='23503')throw new ListingDraftInputError();throw error;}
 }
}
```

### src/lib/listing-payment-start.ts

```typescript
import type {accountTestPayment} from './client-account-test-payment';
import type {ListingCheckoutInput} from './listing-checkout-contract';
export type ListingCheckoutAttempt={input:ListingCheckoutInput|null;uncertain:boolean;completedId?:string};
type Transport=Pick<typeof accountTestPayment,'preview'|'prepare'>;
/** Called only by an explicit payment click. A lost reply requires readback, not a second order. */
export async function startListingPayment(transport:Transport,owner:string,id:string,revision:string,attempt:ListingCheckoutAttempt,options:{signal?:AbortSignal}){
 options.signal?.throwIfAborted();
 if(attempt.completedId)return attempt.completedId;
 if(attempt.uncertain)throw Error('Сначала проверьте сохранённый заказ.');
 const quote=await transport.preview(owner,id,revision,options);
 options.signal?.throwIfAborted();
 if(quote.activePayment){attempt.completedId=quote.activePayment.id;return quote.activePayment.id;}
 if(attempt.input&&(attempt.input.listingId!==id||attempt.input.expectedRevision!==revision))throw Error('Объявление изменилось. Проверьте сохранённую версию.');
 // Reached only after a fresh explicit click (and, after an unknown outcome,
 // explicit readback). Keep the original key even when the offer has changed.
 attempt.input={listingId:id,expectedRevision:revision,creationKey:attempt.input?.creationKey??crypto.randomUUID(),expectedTariffId:quote.tariff.id,expectedAmount:quote.tariff.amount,expectedDurationDays:quote.tariff.durationDays};
 attempt.uncertain=true;
 const order=await transport.prepare(owner,attempt.input,options);
 attempt.uncertain=false;attempt.completedId=order.id;
 return order.id;
}
```

### src/components/listings/PrimaryListingFormButton.tsx

```typescript
"use client";
import {useEffect,useId,useRef,useState} from 'react';
import {usePrimaryAccountAuth} from '@/components/auth/AccountAuthProvider';
import {productionDrafts} from '@/lib/client-listing-drafts';
import {productionListingMedia} from '@/lib/client-listing-media';
import {productionListingForm,ListingFormClientError} from '@/lib/client-listing-form';
import {createListingFormSave} from '@/lib/listing-form-save';
import {createListingFormModeration} from '@/lib/listing-form-moderation';
import {listingModeration} from '@/lib/client-listing-moderation';
import {checkListingFormContent} from '@/lib/listing-publication-check';
import {readListingFormData} from '@/lib/listing-form-data';
import type {ListingFormSnapshot} from '@/lib/listing-form-contract';
import type {UploadedImage} from '@/lib/media-upload-contract';
import {ListingDraftInputError} from '@/lib/listing-draft-contract';
import {useDraftLeaveGuard} from './useDraftLeaveGuard';
import {draftButton} from './PrivateDraftEditor';
import {useListingPostmoderation} from './ListingWorkflowProvider';
import {accountTestPayment} from '@/lib/client-account-test-payment';
import {startListingPayment,type ListingCheckoutAttempt} from '@/lib/listing-payment-start';

export function PrimaryListingFormButton({draft,label,returnHref,className,existing,expectedOwnerId}:{draft:boolean;label:string;returnHref:string;className?:string;existing?:ListingFormSnapshot;expectedOwnerId?:string}){
 const postmoderation=useListingPostmoderation(),submitLabel=postmoderation?'Перейти к оплате':'Отправить на модерацию';
 const auth=usePrimaryAccountAuth(),identity=auth?.state==='signed-in'||auth?.state==='admin'?auth.userId:null;
 const owner=identity&&(!expectedOwnerId||identity===expectedOwnerId)?identity:null;
 const attempt=useRef<ReturnType<typeof createListingFormSave>|null>(null),formRef=useRef<HTMLFormElement|null>(null),pending=useRef(false),epoch=useRef(0);
 const moderation=useRef<ReturnType<typeof createListingFormModeration>|null>(null),controlsRef=useRef<HTMLFieldSetElement|null>(null),intentKey=useId();
 const [busy,setBusy]=useState(false),[message,setMessage]=useState<string|null>(null),[remote,setRemote]=useState<ListingFormSnapshot|null>(null),[active,setActive]=useState(false),[done,setDone]=useState(false);
 const controller=useRef<AbortController|null>(null);
 const baseline=useRef(existing),readyFiles=useRef(new Map<Blob,UploadedImage>());
 const [rejected,setRejected]=useState(false);
 const checkout=useRef<ListingCheckoutAttempt>({input:null,uncertain:false}),paymentId=useRef<string|null>(null);
 const [paymentUncertain,setPaymentUncertain]=useState(false);
 useDraftLeaveGuard(active&&!done);
 useEffect(()=>{const scope=new AbortController();controller.current=scope;const generation=++epoch.current;
  return()=>{epoch.current=generation+1;scope.abort();};
 },[]);
 useEffect(()=>{
  if(!active||done||!formRef.current)return;
  // The sibling fieldset stays locked even when its button rerenders on a
  // session recheck; a React update to button.disabled cannot unlock its parent.
  const controls=Array.from(formRef.current.querySelectorAll<HTMLInputElement|HTMLButtonElement|HTMLFieldSetElement>('input,textarea,select,button,fieldset[data-primary-group]')).filter(control=>control!==controlsRef.current&&!controlsRef.current?.contains(control)).map(control=>({control,disabled:control.disabled}));
  controls.forEach(({control})=>{control.disabled=true;});
  return()=>{controls.forEach(({control,disabled})=>{control.disabled=disabled;});};
 },[active,done]);
 useEffect(()=>{if(done)window.location.assign(paymentId.current?`/oplata/${paymentId.current}`:returnHref);},[done,returnHref]);
 async function finish(){
  if(!draft&&postmoderation){
   const saved=attempt.current?.completed;if(!saved||!owner)throw Error('Сначала подтвердите сохранение формы.');
   try{paymentId.current=await startListingPayment(accountTestPayment,owner,saved.id,saved.revision,checkout.current,{signal:controller.current?.signal});}
   finally{if(!controller.current?.signal.aborted)setPaymentUncertain(checkout.current.uncertain);}
  }
  if(!draft&&!postmoderation){
   const saved=attempt.current?.completed;if(!saved||!owner)throw Error('Сначала подтвердите сохранение формы.');
   moderation.current??=createListingFormModeration(owner,saved,listingModeration);
   await moderation.current.submit({signal:controller.current?.signal});
  }
  if(!controller.current?.signal.aborted)setDone(true);
 }
 async function run(work:()=>Promise<void>){
  if(pending.current||!owner)return;pending.current=true;setBusy(true);setMessage(null);const generation=epoch.current;
  try{await work();}catch(error){if(generation===epoch.current){setMessage(error instanceof ListingDraftInputError?'Проверьте поля объявления: цену, контакты, координаты и параметры аренды.':error instanceof Error?error.message:'Не удалось подтвердить сохранение.');
   if(error instanceof ListingFormClientError&&['INVALID_INPUT','RATE_LIMITED'].includes(error.code))setRejected(true);
  }}
  finally{if(generation===epoch.current){pending.current=false;setBusy(false);if(formRef.current)delete formRef.current.dataset.primarySaving;}}
 }
 async function save(form:HTMLFormElement){
  if(form.dataset.primaryIntent&&form.dataset.primaryIntent!==intentKey){setMessage('В этой форме уже выполняется сохранение. Сначала проверьте его результат.');return;}
  if(form.dataset.primarySaving==='1')return;form.dataset.primarySaving='1';formRef.current=form;
  await run(async()=>{
   if(!attempt.current){
    const consent=form.querySelector<HTMLInputElement>('input[name="placementRightsAccepted"]');
    if(!consent?.checked)throw new Error('Подтвердите право размещать объявление и фотографии.');
    if(!draft&&postmoderation&&!form.querySelector<HTMLInputElement>('input[name="publicOfferAccepted"]')?.checked)throw new Error('Примите условия публичной оферты, чтобы перейти к оплате.');
    const data=new FormData(form),files=data.getAll('photos').filter((item):item is File=>item instanceof File&&item.size>0);
    const input=readListingFormData(data);
    if(!draft){const issues=checkListingFormContent(input,true);if(issues.length)throw Error(issues.map(issue=>issue.message).join(' '));}
    attempt.current=createListingFormSave(owner!,input,files,{create:productionDrafts.createEmpty,upload:async(user,intent,file,options)=>{
     const cached=readyFiles.current.get(file);if(cached)return cached;
     const uploaded=await productionListingMedia.upload(user,intent,file,options);readyFiles.current.set(file,uploaded);return uploaded;
    },read:productionListingForm.read,write:productionListingForm.write},baseline.current);form.dataset.primaryIntent=intentKey;setActive(true);
   }
   await attempt.current.save({signal:controller.current?.signal});await finish();
  });
 }
 return <fieldset ref={controlsRef} data-primary-group className="grid min-w-0 gap-3 md:contents">
  <button type="button" data-primary-control={draft?'save':'submit'} className={className??`${draftButton} bg-[#0875d1] text-white`} disabled={busy||!owner||!!attempt.current?.uncertain||!!moderation.current?.uncertain||paymentUncertain} onClick={event=>{
   if(event.currentTarget.form)void save(event.currentTarget.form);
  }}>{busy?(draft?'Сохраняем поля и фотографии…':'Сохраняем объявление…'):(draft?label:submitLabel)}</button>
  {!draft&&!active&&<p className="min-w-0 flex-1 basis-64 self-center text-sm text-slate-600 md:col-span-full">{postmoderation?'Объявление появится в каталоге после подтверждения оплаты. Сначала проверим поля и сохраним фотографии.':'Сначала бесплатная проверка модератором. Отправка не публикует объявление и не списывает деньги.'}</p>}
  {active&&!done&&<p className="text-sm text-slate-600 md:col-span-full" role="status">Сохраняется снимок формы на момент нажатия. До подтверждения результата не создавайте объявление повторно.</p>}
  {message&&<p className="break-words text-sm font-semibold text-rose-700 md:col-span-full" role="alert">{message}</p>}
  {paymentUncertain&&<button type="button" className={draftButton} disabled={busy||!owner} onClick={()=>void run(async()=>{
   if(!checkout.current.input)return;const order=await accountTestPayment.recover(owner!,checkout.current.input.creationKey,{signal:controller.current?.signal});
   if(controller.current?.signal.aborted)return;
   checkout.current.uncertain=false;setPaymentUncertain(false);
   if(order){paymentId.current=order.id;setDone(true);}else setMessage('Заказ не найден. Нажмите «Перейти к оплате» ещё раз: исходный ключ сохранён, повторного заказа не будет.');
  })}>Проверить сохранённый заказ</button>}
  {rejected&&attempt.current?.id&&<button type="button" className={draftButton} disabled={busy||!owner} onClick={()=>void run(async()=>{
   const snapshot=await productionListingForm.read(owner!,attempt.current!.id!,{signal:controller.current?.signal});
   baseline.current=snapshot;attempt.current=null;moderation.current=null;setActive(false);setRejected(false);setRemote(null);setMessage('Поля доступны для исправления. Изменения ещё не сохранены.');
   if(formRef.current)delete formRef.current.dataset.primaryIntent;
  })}>Вернуться к исправлению полей</button>}
  {(attempt.current?.uncertain||moderation.current?.uncertain)&&<button type="button" data-primary-control="readback" className={draftButton} disabled={busy} onClick={()=>void run(async()=>{
   if(moderation.current?.uncertain){await moderation.current.readback({signal:controller.current?.signal});if(moderation.current.completed)setDone(true);else setMessage('Отправка не подтверждена. Нажмите «Отправить на модерацию», чтобы отправить сохранённую версию.');}
   else{const value=await attempt.current!.readback({signal:controller.current?.signal});if(attempt.current!.completed){if(draft)await finish();else setMessage(`Форма сохранена. Нажмите «${submitLabel}», чтобы продолжить.`);}else setRemote(value);}
  })}>{moderation.current?.uncertain?'Проверить отправку':'Проверить сохранённую форму'}</button>}
  {!draft&&attempt.current?.completed&&!done&&<a href={returnHref} className="text-sm text-[#0875d1] underline md:col-span-full">Открыть сохранённое объявление в кабинете</a>}
  {remote&&<section className="min-w-0 rounded-lg border border-amber-400 bg-amber-50 p-4 md:col-span-full" aria-label="Сохранённая форма">
   <p>В БД сохранена другая версия. Ниже все её поля; ваши исходные данные сохранены в памяти этой вкладки.</p>
   <pre tabIndex={0} aria-label="Поля сохранённой версии" className="mt-3 max-h-80 overflow-auto whitespace-pre-wrap break-words text-xs focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-700">{JSON.stringify(remote.form,null,2)}</pre>
   <button type="button" data-primary-control="resolve" className={`${draftButton} mt-3`} disabled={busy} onClick={()=>{attempt.current!.acceptRemoteRevision();setRemote(null);void run(async()=>{await attempt.current!.save({signal:controller.current?.signal});await finish();});}}>{draft?'Сохранить мою исходную форму вместо показанной':postmoderation?'Сохранить мою форму вместо показанной и перейти к оплате':'Сохранить мою форму вместо показанной и отправить на модерацию'}</button>
  </section>}
 </fieldset>;
}
```

### src/lib/app-session-transaction.ts

```typescript
import { hashSessionToken } from "./identity";
import type { PostgresDatabase, PostgresQueries } from "./postgres";

export class AppSessionAccessError extends Error {
  constructor() { super("App session access required"); this.name = "AppSessionAccessError"; }
}
type AppPrincipal = { id: string; role: "user" | "admin"; isBlocked: boolean; verified: boolean; authVersion: string };
const liveSession = `token_hash=$1 and user_id=$2 and auth_version=$3 and scope='app'
  and expires_at>clock_timestamp() and last_seen_at>clock_timestamp()-interval '30 minutes'`;

/** User -> session -> resource lock order. Policy is trusted server code, never request fields. */
export async function withAppSessionTransaction<T>(
  db: Pick<PostgresDatabase, "transaction">, token: string, work: (tx: PostgresQueries, user: AppPrincipal) => Promise<T>,
  policy: { requireAdmin?: boolean; denied?: () => Error } = {},
): Promise<T> {
  if (typeof window !== "undefined") throw new Error("App session authorization is server-only");
  const denied = policy.denied ?? (() => new AppSessionAccessError());
  const hash = hashSessionToken(token);
  if (!hash) throw denied();
  return db.transaction(async tx => {
    const { rows: [user] } = await tx.query<AppPrincipal>(`select u.id,u.role,u.is_blocked as "isBlocked",
      u.email_verified_at is not null as verified,u.auth_version::text as "authVersion"
      from app.users u where u.id=(select user_id from app.sessions where token_hash=$1) for update of u`, [hash]);
    if (!user || (policy.requireAdmin && user.role !== "admin") || user.isBlocked || !user.verified) throw denied();
    const values = [hash, user.id, user.authVersion];
    const session = await tx.query(`select token_hash from app.sessions where ${liveSession} for update`, values);
    if (session.rowCount !== 1) throw denied();
    const result = await work(tx, user);
    // Waiting on a resource lock may outlive the session. Do not commit that work.
    const refreshed = await tx.query(`update app.sessions set last_seen_at=least(clock_timestamp(),expires_at)
      where ${liveSession}`, values);
    if (refreshed.rowCount !== 1) throw denied();
    return result;
  });
}
```

### database/permissions/listing-checkout-dispatch.sql

```sql
-- Explicit approved operator plan. TEST dispatch only, never startup/autodeploy DDL.
-- UPDATE(id) permits row locks; the existing immutable trigger forbids every actual UPDATE.
-- Operator must verify the canonical active guard and absence of replication/trigger override.
grant update(id) on app.payment_checkout_intents to blizhniy_runtime;
grant select(intent_id,authorized_at),insert(intent_id)
 on app.payment_dispatch_anchors to blizhniy_runtime;
grant select(intent_id,provider_payment_id),insert(intent_id,provider_payment_id)
 on app.payment_provider_links to blizhniy_runtime;
```

