'use client';

import { useEffect, useState } from 'react';

function requestArchive(action: 'available' | 'download', signal?: AbortSignal) {
  return fetch('/api/account/export', {
    method: 'POST', credentials: 'same-origin', cache: 'no-store', signal,
    headers: { 'Content-Type': 'application/json', 'X-Blizhniy-Request': '1' },
    body: JSON.stringify({ action }),
  });
}

export function AccountExportTrial() {
  const [available, setAvailable] = useState(false);
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState('Проверяем готовность архива…');
  useEffect(() => {
    const controller = new AbortController();
    requestArchive('available', controller.signal).then(async (response) => {
      const ready = response.ok && (await response.json()).available === true;
      setAvailable(ready);
      setStatus(ready ? 'Архив готов к скачиванию.' : response.status === 401 ?
        'Войдите в тестовый аккаунт, чтобы проверить архив.' : response.status === 404 || response.ok ?
          'Готового архива пока нет.' : 'Не удалось проверить готовность архива.');
    }).catch(() => {
      if (!controller.signal.aborted) setStatus('Не удалось проверить готовность архива.');
    });
    return () => controller.abort();
  }, []);

  async function download() {
    setPending(true);
    try {
      const response = await requestArchive('download');
      if (response.status === 401 || response.status === 404) {
        setAvailable(false);
        setStatus(response.status === 401 ? 'Войдите в тестовый аккаунт и повторите запрос.' : 'Архив больше недоступен.');
        return;
      }
      if (!response.ok) throw new Error('Download unavailable');
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement('a');
      link.href = url;
      link.download = 'blizhniy-account.tar.gz';
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setStatus('Скачивание началось.');
    } catch {
      setStatus('Не удалось скачать архив. Попробуйте ещё раз.');
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <p className="mt-4 text-sm" role="status">{status}</p>
      {available && <button type="button" className="mt-4 rounded-xl bg-[#0875d1] px-4 py-3 font-semibold text-white"
        disabled={pending} onClick={download}>Скачать готовый архив</button>}
    </>
  );
}
