'use client';

import { useState, type FormEvent } from 'react';
import { usePrimaryAccountAuth } from '@/components/auth/AccountAuthProvider';

function ApprovalForm({ administratorId }: { administratorId: string }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [prepared, setPrepared] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || prepared) return;
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setMessage('');
    try {
      const response = await fetch('/api/admin/account-export', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'X-Blizhniy-Request': '1' },
        body: JSON.stringify({ caseId: form.get('caseId'), expectedAdminId: administratorId }),
      });
      if (!response.ok) throw new Error('Preparation did not complete');
      setPrepared(true);
      setMessage('Архив подготовлен. Оператор проверит его и откроет скачивание в кабинете.');
    } catch {
      setMessage('Архив не готов. Перед повторной попыткой уточните результат у оператора.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="account-export-heading" className="mb-5 max-w-lg rounded-xl border border-slate-200 bg-white p-4">
      <h2 id="account-export-heading" className="font-semibold text-slate-900">Выдача персональных данных</h2>
      <form onSubmit={submit} className="mt-3 space-y-3">
        <div>
          <label htmlFor="account-export-case" className="text-sm font-semibold">Номер проверенного обращения</label>
          <input id="account-export-case" name="caseId" required minLength={6} maxLength={80} pattern={'[A-Za-z0-9_\\-]{6,80}'}
            autoComplete="off" spellCheck={false} disabled={busy || prepared}
            className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 px-3" />
        </div>
        <button type="submit" disabled={busy || prepared}
          className="min-h-11 rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-brand-blue disabled:opacity-50">
          {busy ? 'Готовим архив…' : 'Подготовить архив'}
        </button>
      </form>
      {message && <p role={prepared ? 'status' : 'alert'} className="mt-3 text-sm text-slate-700">{message}</p>}
    </section>
  );
}

export function AdminAccountExportApproval() {
  const auth = usePrimaryAccountAuth();
  if (auth?.state !== 'admin' || !auth.userId) return null;
  return <ApprovalForm key={auth.userId} administratorId={auth.userId} />;
}
