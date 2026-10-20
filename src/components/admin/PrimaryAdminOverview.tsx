"use client";
import Link from 'next/link';
import {useEffect, useState} from 'react';
import {usePrimaryAccountAuth} from '@/components/auth/AccountAuthProvider';
import {adminOverview, AdminOverviewClientError} from '@/lib/client-admin-overview';
import type {AdminOverview} from '@/lib/admin-overview-contract';

function OverviewData({actor}: {actor: string}) {
  const [data, setData] = useState<AdminOverview | null>(null), [error, setError] = useState('');
  const [loading, setLoading] = useState(true), [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController(); let active = true;
    setLoading(true); setError(''); setData(null);
    adminOverview.read(actor, {signal: controller.signal}).then(value => {
      if (active) setData(value);
    }).catch(error => {
      if (active) setError(error instanceof AdminOverviewClientError ? error.message : 'Не удалось загрузить обзор. Повторите запрос.');
    }).finally(() => {if (active) setLoading(false);});
    return () => {active = false; controller.abort();};
  }, [actor, revision]);
  const metrics = [
    {label: 'Пользователи', value: data ? String(data.users.total) : '—', detail: data ? `${data.users.blocked} заблокированных аккаунтов` : 'Данные не загружены'},
    {label: 'Публикации', value: data ? String(data.publications.total) : '—', detail: data ? `${data.publications.awaitingReview} ожидают модерации` : 'Данные не загружены'},
    {label: 'Тарифы', value: data ? `${data.tariffs.active}/${data.tariffs.total}` : '—', detail: 'Активные тарифы из базы'},
    {label: 'Бегущая строка', value: data ? String(data.adMarquee.total) : '—', detail: data ? `${data.adMarquee.awaitingReview} ожидают проверки` : 'Данные не загружены'},
  ];
  return <section aria-label="Рабочий обзор админки" aria-busy={loading}>
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-sm text-slate-600">Данные рабочей базы. В очереди — только отправленные актуальные версии.</p>
      <button type="button" disabled={loading} onClick={() => setRevision(value => value + 1)} className="min-h-11 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-slate-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:opacity-60">Обновить обзор</button>
    </div>
    {loading && <p role="status" className="mt-3 text-sm text-slate-600">Загружаем обзор…</p>}
    {error && <p role="alert" className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
    <dl className="mt-4 grid grid-cols-1 gap-3 min-[360px]:grid-cols-2 xl:grid-cols-4">
      {metrics.map(metric => <div key={metric.label} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <dt className="text-sm font-bold text-slate-600">{metric.label}</dt><dd className="mt-2 text-2xl font-bold text-slate-950">{metric.value}</dd>
        <dd className="mt-1 text-xs leading-5 text-slate-600">{loading ? 'Загружаем…' : metric.detail}</dd>
      </div>)}
    </dl>
    <div className="mt-5 rounded-lg border border-slate-200 bg-white p-4">
      <h2 className="text-lg font-bold text-slate-950">Модерация и управление</h2>
      <p className="mt-2 text-sm leading-6 text-slate-600">Одобрение разрешает оплату; объявление не публикуется до подтверждённой оплаты. Черновики, которые владелец ещё не отправил, в очередь не попадают.</p>
      <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {[
          ['/admin/obyavleniya', 'Объявления'], ['/admin/vakansii', 'Вакансии'], ['/admin/zakazy', 'Заказы'],
          ['/admin/specialisty', 'Специалисты'], ['/admin/fair-applications', 'Ярмарка'], ['/admin/ad-marquee', 'Бегущая строка'],
          ['/admin/users', 'Пользователи'], ['/admin/tariffs', 'Тарифы'], ['/admin/payments', 'Платежи'],
        ].map(([href, label]) => <Link key={href} href={href} className="flex min-h-11 items-center rounded-lg border border-slate-200 px-4 py-2 text-sm font-bold text-blue-700 hover:bg-blue-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600">{label}</Link>)}
      </div>
    </div>
  </section>;
}
export function PrimaryAdminOverview() {
  const auth = usePrimaryAccountAuth();
  if (auth?.state !== 'admin' || !auth.userId) return <p role="status" className="text-sm text-slate-600">{auth?.state === 'loading' ? 'Проверяем права администратора…' : 'Доступ администратора не подтверждён.'}</p>;
  // Unmount the private reader immediately on any identity recheck; late responses cannot restore hidden counts.
  return <OverviewData key={auth.userId} actor={auth.userId}/>;
}
