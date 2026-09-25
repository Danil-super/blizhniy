'use client';

import { useEffect, useRef, useState } from 'react';
import { getSupabaseBrowserClient } from '@/lib/supabase-browser';

type QueueRequest = {
  id: string;
  user_id: string;
  email: string | null;
  status: 'requested' | 'in_review';
  requested_at: string;
};

export function AdminAccountDeletionRequestsClient() {
  const [requests, setRequests] = useState<QueueRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState('');
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

        const response = await fetch('/api/admin/account-deletion-requests', {
          headers: { Authorization: `Bearer ${data.session.access_token}` },
          cache: 'no-store',
        });
        if (!response.ok) throw new Error('Не удалось загрузить очередь.');

        const payload = (await response.json()) as { requests: QueueRequest[] };
        if (active && current === generation.current) setRequests(payload.requests);
      } catch (caught) {
        if (active && current === generation.current) setError(caught instanceof Error ? caught.message : 'Не удалось загрузить очередь.');
      } finally {
        if (active && current === generation.current) setLoading(false);
      }
    }

    void refresh();
    const { data: listener } = supabase.auth.onAuthStateChange(() => {
      window.setTimeout(() => { if (active) void refresh(); }, 0);
    });

    return () => {
      active = false;
      generation.current += 1;
      listener.subscription.unsubscribe();
    };
  }, []);

  async function startReview(id: string) {
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
        body: JSON.stringify({ requestId: id }),
      });

      if (!response.ok) throw new Error('Не удалось начать проверку. Обновите страницу.');

      if (current === generation.current) {
        setRequests((items) => items.map((item) => item.id === id ? { ...item, status: 'in_review' } : item));
      }
    } catch (caught) {
      if (current === generation.current) setError(caught instanceof Error ? caught.message : 'Не удалось начать проверку.');
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
      {requests.length === 100 ? <p className="mt-4 text-amber-800">Показаны первые 100 запросов; для полного журнала используйте служебную базу.</p> : null}
      {!requests.length ? <p className="mt-5 text-slate-600">Ожидающих запросов нет.</p> : (
        <div className="mt-5 space-y-3">
          {requests.map((item) => (
            <article key={item.id} className="rounded-lg border border-slate-200 p-4 [overflow-wrap:anywhere]">
              <p className="font-semibold text-slate-900">{item.email ?? 'Email не указан'} · {item.status === 'requested' ? 'Ожидает' : 'Проверяется'}</p>
              <p className="mt-1 text-sm text-slate-600">Получен: {new Date(item.requested_at).toLocaleString('ru-RU')}</p>
              <p className="mt-1 text-xs text-slate-500">Заявление: {item.id} · Пользователь: {item.user_id}</p>
              {item.status === 'requested' ? (
                <button
                  type="button"
                  disabled={busyId === item.id}
                  onClick={() => void startReview(item.id)}
                  className="mt-3 min-h-10 rounded-lg border border-blue-200 px-4 font-semibold text-[#0875d1] disabled:opacity-60"
                >
                  {busyId === item.id ? 'Сохраняем...' : 'Начать проверку'}
                </button>
              ) : null}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
