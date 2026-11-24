'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { usePrimaryAccountAuth } from '@/components/auth/AccountAuthProvider';
import { refundButton, useAdminRefundActions } from './AdminRefundActions';
import { loadAdminPaymentJournal } from '@/lib/client-admin-payment-journal';
import {
 journalOrderStatuses, journalTargetTypes, type AdminPaymentJournalItem,
 type AdminPaymentJournalPage, type AdminPaymentJournalQuery,
} from '@/lib/admin-payment-journal-contract';

const kinds = { listing:'Объявление', vacancy:'Вакансия', workRequest:'Заказ', specialist:'Анкета',
 application:'Отклик', fair_application:'Ярмарка', ad_marquee:'Бегущая строка' };
const orderStatuses = { created:'Подготовлен', pending:'Обрабатывается', succeeded:'Оплачен', failed:'Не завершён', refunded:'Возвращён' };
const providerStatuses = { not_sent:'Отправка не начата', unknown:'Результат отправки неизвестен', awaiting_verification:'Ожидает сверки',
 pending:'Платёж ожидается', waiting_for_capture:'Ожидает списания', succeeded:'Подтверждён', canceled:'Отменён' };
const reconciliations = { queued:'В очереди', processing:'В работе', completed:'Завершена', blocked:'Заблокирована', waiting_phone:'Ожидает подтверждения телефона' };
const causes = { provider_pending:'Платёж ожидается', capture_required:'Ожидается подтверждение списания',
 processing_unavailable:'Сверка недоступна', publication_blocked:'Исполнение запрещено',
 attempts_exhausted:'Исчерпаны попытки', phone_required:'Нужно подтвердить телефон' };
const fulfillments = { not_recorded:'Исполнение не зафиксировано', unavailable:'Учёт доставки недоступен', fulfilled:'Размещение исполнено', delivered:'Отклик доставлен' };
const refunds = { unavailable:'Журнал возвратов недоступен', none:'Возврат не зарегистрирован', approved:'Одобрен', reserved:'Зарезервирован',
 prepared:'Подготовлен', unknown:'Результат отправки неизвестен', awaiting_verification:'Ожидает сверки',
 pending:'Обрабатывается', succeeded:'Подтверждён, ожидает применения', canceled:'Отменён', applied:'Применён' };
const compensations = { not_applicable:'Не применяется', unavailable:'Учёт компенсаций недоступен', none:'Компенсация не зарегистрирована',
 eligible:'Основание зафиксировано', queued:'В очереди', processing:'В работе', completed:'Обработка завершена', blocked:'Заблокирована', applied:'Применена' };

const control = 'min-h-11 rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-700';
const money = new Intl.NumberFormat('ru-RU', { style:'currency', currency:'RUB' });
const date = (value: string) => new Intl.DateTimeFormat('ru-RU', { dateStyle:'medium', timeStyle:'short', timeZone:'Europe/Moscow' }).format(new Date(value));
function StatusTime({ value }: { value: string | null }) {
 return value && <time dateTime={value} className="block text-xs text-slate-600">{date(value)}</time>;
}
function JournalEntry({ row, actions }: { row: AdminPaymentJournalItem; actions?:ReactNode }) {
 return <li className="min-w-0 rounded-lg border border-slate-200 bg-white p-4">
  <div className="flex flex-wrap justify-between gap-2"><div><h3 className="font-bold text-slate-950">{kinds[row.targetType]}</h3><StatusTime value={row.createdAt}/></div>
   <p className="font-bold text-slate-950">{money.format(Number(row.amount))}</p></div>
  <dl className="my-3 grid grid-cols-1 gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3 [&_dt]:font-semibold [&_dt]:text-slate-700 [&_dd]:text-slate-950">
   <div><dt>Заказ</dt><dd>{orderStatuses[row.orderStatus]}</dd></div>
   <div><dt>Провайдер</dt><dd>{providerStatuses[row.providerStatus]}<StatusTime value={row.capturedAt}/></dd></div>
   <div><dt>Сверка</dt><dd>{row.reconciliation ? reconciliations[row.reconciliation] : 'Задание не создано'}
    {row.reconciliationCode && <span className="block text-xs">{causes[row.reconciliationCode]}</span>}</dd></div>
   <div><dt>Исполнение</dt><dd>{fulfillments[row.fulfillment]}<StatusTime value={row.fulfilledAt}/></dd></div>
   <div><dt>Возврат</dt><dd>{refunds[row.refund]}<StatusTime value={row.refundedAt}/></dd></div>
   {row.compensation !== 'not_applicable' && <div><dt>Компенсация отклика</dt><dd>{compensations[row.compensation]}</dd></div>}
  </dl>
  <details className="text-sm text-slate-700"><summary className="cursor-pointer py-2">Идентификаторы заказа и назначения</summary>
   <p className="break-all">Заказ {row.id}</p><p className="break-all">Назначение {row.targetId}</p></details>
  {actions && <div className="mt-2">{actions}</div>}
 </li>;
}
function Journal({ actor, refundActions }: { actor: string; refundActions:boolean }) {
 const [query, setQuery] = useState<AdminPaymentJournalQuery>({ expectedAdminId:actor, kind:null, status:null, after:null });
 const [completed, setCompleted] = useState<{ query:AdminPaymentJournalQuery; page?:AdminPaymentJournalPage; error?:string } | null>(null);
 const view = completed?.query === query ? completed : null;
 const actions = useAdminRefundActions(actor, refundActions, () => setQuery(current => ({ ...current })));
 function navigate(next:AdminPaymentJournalQuery) {
  if (actions.working.current) return;
  actions.select(null);
  setQuery(next);
 }
 useEffect(() => {
  const controller = new AbortController();
  void loadAdminPaymentJournal(query, controller.signal).then(result => {
   if (!controller.signal.aborted) setCompleted({ query, ...result });
  }).catch(() => {
   if (!controller.signal.aborted) setCompleted({ query, error:'Журнал платежей недоступен. Повторите загрузку.' });
  });
  return () => controller.abort();
 }, [query]);
 return <section aria-label="Журнал TEST-платежей" aria-busy={!view || actions.busy}>
  <div className="flex flex-wrap gap-3">
   <label className="grid gap-1 text-sm font-semibold text-slate-700">Тип платежа<select className={control} value={query.kind ?? ''} disabled={actions.busy}
    onChange={event => navigate({ ...query, kind:(event.target.value || null) as AdminPaymentJournalQuery['kind'], after:null })}>
    <option value="">Все виды</option>{journalTargetTypes.map(kind => <option key={kind} value={kind}>{kinds[kind]}</option>)}
   </select></label>
   <label className="grid gap-1 text-sm font-semibold text-slate-700">Статус заказа<select className={control} value={query.status ?? ''} disabled={actions.busy}
    onChange={event => navigate({ ...query, status:(event.target.value || null) as AdminPaymentJournalQuery['status'], after:null })}>
    <option value="">Все статусы</option>{journalOrderStatuses.map(status => <option key={status} value={status}>{orderStatuses[status]}</option>)}
   </select></label>
   <button type="button" className={control + ' self-end'} disabled={actions.busy} onClick={() => navigate({ ...query, after:null })}>Обновить журнал</button>
  </div>
  {!view && <p role="status" className="mt-4 text-sm text-slate-600">Загружаем журнал…</p>}
  {view?.error && <p role="alert" className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{view.error}</p>}
  {view?.page && actions.panel}
  {view?.page && (view.page.items.length === 0
   ? <p className="mt-4 text-sm text-slate-600">По выбранным условиям платежей нет.</p>
   : <ul className="mt-4 grid gap-3">{view.page.items.map(row => {
    const action = refundActions ? row.refundAction : null;
    const button = action && <button type="button" className={refundButton} disabled={actions.disabled} onClick={() => {
     const recovery = action.kind === 'recover' ? action : null;
     actions.select({kind:action.kind,row:{id:row.id,amount:row.amount,operationId:recovery?.operationId??null,
      providerRefundId:recovery?.providerRefundId??null}});
    }}>{action.kind === 'approve' ? 'Вернуть плату' : action.providerRefundId ? 'Сверить возврат' : 'Сверить по номеру ЮKassa'}</button>;
    return <JournalEntry key={row.id} row={row} actions={button}/>;
   })}</ul>)}
  {view?.page?.nextAfter && <button type="button" className={control + ' mt-4'} disabled={actions.busy}
   onClick={() => navigate({ ...query, after:view.page!.nextAfter })}>Следующие платежи</button>}
 </section>;
}
export function PrimaryAdminPaymentJournal({refundActions=false}:{refundActions?:boolean}) {
 const auth = usePrimaryAccountAuth();
 if (auth?.state !== 'admin' || !auth.userId) return <p role="status" className="text-sm text-slate-600">
  {auth?.state === 'loading' ? 'Проверяем права администратора…' : 'Доступ администратора не подтверждён.'}</p>;
 return <Journal key={auth.userId} actor={auth.userId} refundActions={refundActions}/>;
}
