'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { getSupabaseBrowserClient } from '@/lib/supabase-browser';

type DeletionRequest = {
  id: string;
  status: 'requested' | 'in_review' | 'resolved';
  requested_at: string;
  resolution: 'fulfilled' | 'partly_retained' | 'declined' | null;
};

const supportEmail = 'prostova04@yandex.ru';
const sessionChangedError = 'Сессия изменилась. Войдите в аккаунт повторно и отправьте запрос ещё раз.';

type AuthenticatedSession = {
  userId: string;
  accessToken: string;
};

type SessionReader = () => Promise<{
  data: { session: Session | null };
  error: Error | null;
}>;

function toAuthenticatedSession(session: Session | null | undefined): AuthenticatedSession | null {
  const userId = session?.user?.id;
  const accessToken = session?.access_token;

  return userId && accessToken ? { userId, accessToken } : null;
}

async function readAuthenticatedSession(readSession: SessionReader) {
  const { data, error } = await readSession();

  if (error) {
    throw error;
  }

  return toAuthenticatedSession(data.session);
}

function isSameSession(left: AuthenticatedSession, right: AuthenticatedSession | null) {
  return Boolean(right && left.userId === right.userId && left.accessToken === right.accessToken);
}

/**
 * Re-check the browser session immediately before and after the destructive
 * request. The POST always receives the token that was bound to the screen
 * which initiated the action, never a token read after an account switch.
 */
export async function submitBoundAccountDeletionRequest(
  origin: AuthenticatedSession,
  readSession: SessionReader,
  sendRequest: (accessToken: string) => Promise<Response>,
  isOriginCurrent: () => boolean,
) {
  if (!isOriginCurrent() || !isSameSession(origin, await readAuthenticatedSession(readSession))) {
    throw new Error(sessionChangedError);
  }

  const response = await sendRequest(origin.accessToken);

  if (!isOriginCurrent() || !isSameSession(origin, await readAuthenticatedSession(readSession))) {
    throw new Error(sessionChangedError);
  }

  return response;
}

function statusText(request: DeletionRequest) {
  if (request.status === 'requested') return 'Запрос получен и ожидает проверки';
  if (request.status === 'in_review') return 'Запрос проверяется';
  return request.resolution === 'fulfilled'
    ? 'Рассмотрение завершено: данные удалены в подтверждённом оператором объёме'
    : 'Рассмотрение завершено: уточните решение у оператора по email';
}

export function AccountDeletionRequestClient() {
  const [request, setRequest] = useState<DeletionRequest | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [signedOut, setSignedOut] = useState(false);
  const [error, setError] = useState('');
  const generation = useRef(0);
  const authenticatedSession = useRef<AuthenticatedSession | null>(null);

  useEffect(() => {
    let active = true;
    const supabase = getSupabaseBrowserClient();

    async function refresh() {
      const current = ++generation.current;
      setLoading(true);
      setRequest(null);
      setSubmitting(false);
      setSignedOut(false);
      setError('');
      authenticatedSession.current = null;

      try {
        const { data, error: sessionError } = await supabase.auth.getSession();
        if (sessionError) throw sessionError;

        const session = toAuthenticatedSession(data.session);
        if (!session) {
          if (active && current === generation.current) setSignedOut(true);
          return;
        }

        const response = await fetch('/api/cabinet/account-deletion', {
          headers: { Authorization: `Bearer ${session.accessToken}` },
          cache: 'no-store',
        });

        if (!response.ok) throw new Error('Не удалось получить статус запроса. Попробуйте позже.');

        const payload = (await response.json()) as { request: DeletionRequest | null };
        if (active && current === generation.current) {
          authenticatedSession.current = session;
          setSignedOut(false);
          setRequest(payload.request);
        }
      } catch (caught) {
        if (active && current === generation.current) {
          setError(caught instanceof Error ? caught.message : 'Не удалось получить статус запроса.');
        }
      } finally {
        if (active && current === generation.current) setLoading(false);
      }
    }

    void refresh();
    const { data: listener } = supabase.auth.onAuthStateChange(() => {
      // Invalidate the old screen synchronously. The scheduled refresh below
      // must not leave a moment in which its action can use the next account.
      generation.current += 1;
      authenticatedSession.current = null;
      if (active) {
        setLoading(true);
        setRequest(null);
        setSignedOut(false);
        setError('');
      }
      window.setTimeout(() => { if (active) void refresh(); }, 0);
    });

    return () => {
      active = false;
      generation.current += 1;
      authenticatedSession.current = null;
      listener.subscription.unsubscribe();
    };
  }, []);

  async function submit() {
    const current = generation.current;
    const origin = authenticatedSession.current;
    setSubmitting(true);
    setError('');

    try {
      if (!origin) throw new Error('Войдите в аккаунт повторно.');

      const supabase = getSupabaseBrowserClient();
      const isOriginCurrent = () => (
        current === generation.current
        && authenticatedSession.current?.userId === origin.userId
        && authenticatedSession.current?.accessToken === origin.accessToken
      );
      const response = await submitBoundAccountDeletionRequest(
        origin,
        () => supabase.auth.getSession(),
        (accessToken) => fetch('/api/cabinet/account-deletion', {
          method: 'POST',
          headers: { Authorization: `Bearer ${accessToken}` },
          cache: 'no-store',
        }),
        isOriginCurrent,
      );
      const payload = (await response.json().catch(() => null)) as { request?: DeletionRequest; error?: string } | null;

      if (!isOriginCurrent()) throw new Error(sessionChangedError);
      if (!response.ok || !payload?.request) {
        throw new Error(payload?.error ?? 'Не удалось отправить запрос. Попробуйте позже.');
      }

      if (current === generation.current) setRequest(payload.request);
    } catch (caught) {
      if (current === generation.current) setError(caught instanceof Error ? caught.message : 'Не удалось отправить запрос.');
    } finally {
      if (current === generation.current) setSubmitting(false);
    }
  }

  return (
    <section aria-labelledby="deletion-title" className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
      <h1 id="deletion-title" className="text-2xl font-bold text-[#060b27]">Запрос на удаление аккаунта</h1>
      <p className="mt-3 max-w-3xl text-slate-700">
        Оператор проверит запрос, активные публикации, оплаченные услуги и сведения,
        которые он обязан сохранить по закону. Отправка запроса не удаляет аккаунт немедленно.
      </p>

      {loading ? <p className="mt-6 text-slate-600">Проверяем статус...</p> : null}

      {!loading && signedOut ? (
        <p className="mt-6 text-slate-700">
          <Link href="/auth" className="font-semibold text-[#0875d1] underline">Войдите в аккаунт</Link>, чтобы отправить запрос.
          Если войти не получается, напишите на <a href={`mailto:${supportEmail}`} className="font-semibold text-[#0875d1] underline">{supportEmail}</a>.
        </p>
      ) : null}

      {!loading && !signedOut && request ? (
        <div className="mt-6 rounded-lg border border-blue-200 bg-blue-50 p-4 text-slate-800" role="status">
          <p className="font-semibold">{statusText(request)}</p>
          <p className="mt-2 text-sm">Номер запроса: {request.id}</p>
          <p className="mt-1 text-sm">Получен: {new Date(request.requested_at).toLocaleString('ru-RU')}</p>
          <p className="mt-2 text-sm">
            По вопросам решения напишите на <a href={`mailto:${supportEmail}`} className="text-[#0875d1] underline">{supportEmail}</a>, указав номер запроса.
          </p>
        </div>
      ) : null}

      {!loading && !signedOut && request?.status === 'resolved' ? (
        <button
          type="button"
          disabled={submitting}
          onClick={() => void submit()}
          className="mt-5 min-h-11 rounded-lg border border-blue-200 px-5 font-semibold text-[#0875d1] disabled:opacity-60"
        >
          {submitting ? 'Отправляем запрос...' : 'Подать новый запрос'}
        </button>
      ) : null}

      {!loading && !signedOut && !request && !error ? (
        <button
          type="button"
          disabled={submitting}
          onClick={() => void submit()}
          className="mt-6 min-h-11 rounded-lg bg-[#0875d1] px-5 font-semibold text-white disabled:opacity-60"
        >
          {submitting ? 'Отправляем запрос...' : 'Отправить запрос на удаление'}
        </button>
      ) : null}

      {error ? <p role="alert" className="mt-5 text-red-700">{error} Обратитесь на <a href={`mailto:${supportEmail}`} className="underline">{supportEmail}</a>, если проблема повторяется.</p> : null}

      <p className="mt-6 text-sm text-slate-600">
        Вы также можете подать запрос по email: <a href={`mailto:${supportEmail}`} className="text-[#0875d1] underline">{supportEmail}</a>.
      </p>
    </section>
  );
}
