'use client';

import { useEffect, useRef, useState } from 'react';
import { getSupabaseBrowserClient } from '@/lib/supabase-browser';

type QueueRequest = {
  id: string;
  user_id: string | null;
  email: string | null;
  status: 'requested' | 'in_review';
  requested_at: string;
};

type Resolution = 'fulfilled' | 'partly_retained' | 'declined';

export function AdminAccountDeletionRequestsClient() {
  const [requests, setRequests] = useState<QueueRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState('');
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [refreshIndex, setRefreshIndex] = useState(0);
  const [resolvingId, setResolvingId] = useState('');
  const [resolution, setResolution] = useState<Resolution>('fulfilled');
  const [caseReference, setCaseReference] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const generation = useRef(0);

  useEffect(() => {
    let active = true;
    const supabase = getSupabaseBrowserClient();

    async function refresh() {
      const current = ++generation.current;
      if (active) {
        setRequests([]);
        setLoading(true);
        setBusyId('');
        setError('');
      }

      try {
        const { data, error: sessionError } = await supabase.auth.getSession();
        if (sessionError || !data.session?.access_token) throw new Error('Сессия истекла. Войдите заново.');

        const response = await fetch(`/api/admin/account-deletion-requests?page=${page}`, {
          headers: { Authorization: `Bearer ${data.session.access_token}` },
          cache: 'no-store',
        });
        if (!response.ok) throw new Error('Не удалось загрузить очередь.');

        const payload = (await response.json()) as { requests: QueueRequest[]; hasMore: boolean };
        if (active && current === generation.current) {
          if (!payload.requests.length && page > 0) {
            setPage(page - 1);
          } else {
            setRequests(payload.requests);
            setHasMore(payload.hasMore);
          }
        }
      } catch (caught) {
        if (active && current === generation.current) setError(caught instanceof Error ? caught.message : 'Не удалось загрузить очередь.');
      } finally {
        if (active && current === generation.current) setLoading(false);
      }
    }

    void refresh();

    return () => {
      active = false;
      generation.current += 1;
    };
  }, [page, refreshIndex]);

  useEffect(() => {
    let active = true;
    const { data: listener } = getSupabaseBrowserClient().auth.onAuthStateChange(() => {
      window.setTimeout(() => {
        if (!active) return;
        setRequests([]);
        setPage(0);
        setRefreshIndex((value) => value + 1);
      }, 0);
    });

    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  async function changeReview(id: string, payload: Record<string, unknown>) {
    const current = generation.current;
    setBusyId(id);
    setError('');

    try {
      const { data, error: sessionError } = await getSupabaseBrowserClient().auth.getSession();
      if (sessionError || !data.session?.access_token) throw new Error('Сессия истекла.');

      const response = await fetch('/api/admin/account-deletion-requests', {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${data.session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ requestId: id, ...payload }),
      });

      const result = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) throw new Error(result?.error ?? 'Не удалось сохранить решение. Обновите страницу.');

      if (current === generation.current) {
        setResolvingId('');
        setCaseReference('');
        setConfirmed(false);
        setRefreshIndex((value) => value + 1);
      }
    } catch (caught) {
      if (current === generation.current) setError(caught instanceof Error ? caught.message : 'Не удалось сохранить решение.');
    } finally {
      if (current === generation.current) setBusyId('');
    }
  }

  if (loading) return <p className="text-slate-600">Загружаем очередь...</p>;

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
      <h2 className="text-xl font-bold text-[#060b27]">Заявления пользователей</h2>
      <p className="mt-2 text-sm text-slate-600">
        Статус «Проверяется» не удаляет аккаунт. Перед закрытием заявления проверьте право на удаление,
        оплаченные услуги и основания хранения документов; решение зафиксируйте в защищённом журнале.
      </p>
      {error ? <p role="alert" className="mt-4 text-red-700">{error}</p> : null}
      {!requests.length && !error ? <p className="mt-5 text-slate-600">На этой странице ожидающих запросов нет.</p> : (
        <div className="mt-5 space-y-3">
          {requests.map((item) => (
            <article key={item.id} className="rounded-lg border border-slate-200 p-4 [overflow-wrap:anywhere]">
              <p className="font-semibold text-slate-900">{item.user_id ? item.email ?? 'Email не указан' : 'Аккаунт уже удалён'} · {item.status === 'requested' ? 'Ожидает' : 'Проверяется'}</p>
              <p className="mt-1 text-sm text-slate-600">Получен: {new Date(item.requested_at).toLocaleString('ru-RU')}</p>
              <p className="mt-1 text-xs text-slate-500">Заявление: {item.id} · Пользователь: {item.user_id ?? 'удалён'}</p>
              {item.status === 'requested' ? (
                <button
                  type="button"
                  disabled={busyId === item.id}
                  onClick={() => void changeReview(item.id, { action: 'begin' })}
                  className="mt-3 min-h-10 rounded-lg border border-blue-200 px-4 font-semibold text-[#0875d1] disabled:opacity-60"
                >
                  {busyId === item.id ? 'Сохраняем...' : 'Начать проверку'}
                </button>
              ) : (
                resolvingId !== item.id ? (
                  <button
                    type="button"
                    onClick={() => { setResolvingId(item.id); setResolution('fulfilled'); setCaseReference(''); setConfirmed(false); }}
                    className="mt-3 min-h-10 rounded-lg border border-slate-300 px-4 font-semibold text-slate-700"
                  >
                    Зафиксировать ручное решение
                  </button>
                ) : (
                  <form
                    className="mt-4 space-y-3 border-t border-slate-200 pt-4"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void changeReview(item.id, { action: 'resolve', resolution, caseReference, confirmedManualDecision: confirmed });
                    }}
                  >
                    <label className="block text-sm font-semibold text-slate-700">
                      Исход рассмотрения
                      <select value={resolution} onChange={(event) => setResolution(event.target.value as Resolution)} className="mt-1 block min-h-10 w-full rounded-lg border border-slate-300 px-3 sm:max-w-md">
                        <option value="fulfilled">Удалено в подтверждённом объёме</option>
                        <option value="partly_retained">Часть данных сохранена по основанию</option>
                        <option value="declined">Отказ с обоснованием</option>
                      </select>
                    </label>
                    <label className="block text-sm font-semibold text-slate-700">
                      Номер дела в защищённом журнале (без персональных данных)
                      <input
                        type="text"
                        required
                        minLength={6}
                        maxLength={80}
                        pattern="[A-Za-z0-9_-]{6,80}"
                        value={caseReference}
                        onChange={(event) => setCaseReference(event.target.value)}
                        className="mt-1 block min-h-10 w-full rounded-lg border border-slate-300 px-3 sm:max-w-md"
                        placeholder="CASE-2026-0001"
                      />
                    </label>
                    <label className="flex max-w-3xl items-start gap-3 text-sm text-slate-700">
                      <input type="checkbox" required checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} className="mt-1" />
                      <span>Подтверждаю, что проверка и необходимые ручные действия выполнены, основание и ответ пользователю оформлены в указанном деле.</span>
                    </label>
                    <div className="flex flex-wrap gap-2">
                      <button type="submit" disabled={busyId === item.id} className="min-h-10 rounded-lg bg-[#0875d1] px-4 font-semibold text-white disabled:opacity-60">
                        {busyId === item.id ? 'Сохраняем...' : 'Закрыть заявление'}
                      </button>
                      <button type="button" onClick={() => setResolvingId('')} className="min-h-10 rounded-lg border border-slate-300 px-4 font-semibold text-slate-700">Отмена</button>
                    </div>
                  </form>
                )
              )}
            </article>
          ))}
        </div>
      )}
      <nav aria-label="Страницы заявлений" className="mt-5 flex items-center gap-3 text-sm">
        <button type="button" disabled={page === 0} onClick={() => setPage((value) => value - 1)} className="min-h-10 rounded-lg border border-slate-300 px-4 font-semibold disabled:opacity-50">Предыдущая</button>
        <span>Страница {page + 1}</span>
        <button type="button" disabled={!hasMore} onClick={() => setPage((value) => value + 1)} className="min-h-10 rounded-lg border border-slate-300 px-4 font-semibold disabled:opacity-50">Следующая</button>
      </nav>
    </section>
  );
}
