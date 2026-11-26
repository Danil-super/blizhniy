'use client';

import { parseAdminPaymentJournalPage, parseAdminPaymentJournalQuery } from './admin-payment-journal-contract.ts';

const errors = {
 UNAUTHENTICATED: { status: 401, message: 'Войдите в аккаунт администратора.' },
 ADMIN_REQUIRED: { status: 403, message: 'Доступ администратора не подтверждён.' },
 RATE_LIMITED: { status: 429, message: 'Слишком много запросов. Повторите позже.' },
};

export function createAdminPaymentJournalClient(transport: typeof fetch) {
 return async (input: unknown, outer: AbortSignal) => {
  const command = parseAdminPaymentJournalQuery(input), signal = AbortSignal.any([outer, AbortSignal.timeout(15000)]);
  signal.throwIfAborted();
  const response = await transport('/api/admin/payment-journal', {
   method: 'POST', credentials: 'same-origin', redirect: 'error', cache: 'no-store', signal,
   headers: { 'Content-Type': 'application/json', 'X-Blizhniy-Request': '1' }, body: JSON.stringify(command),
  });
  if (!response.body || response.headers.get('content-type')?.split(';')[0].trim() !== 'application/json') throw Error();
  const reader = response.body.getReader(), decoder = new TextDecoder('utf-8', { fatal: true });
  let text = '', size = 0, complete = false;
  try {
   for (;;) {
    signal.throwIfAborted();
    const part = await reader.read();
    signal.throwIfAborted();
    if (part.done) { text += decoder.decode(); complete = true; break; }
    size += part.value.byteLength;
    if (size > 65536) throw Error();
    text += decoder.decode(part.value, { stream: true });
   }
  } finally {
   try { if (!complete) await reader.cancel(); } finally { reader.releaseLock(); }
  }
  const value = JSON.parse(text), code = value?.error?.code;
  if (response.status !== 200) {
   if (typeof code === 'string' && Object.hasOwn(errors, code)) {
    const named = errors[code as keyof typeof errors];
    if (response.status === named.status) return { error: named.message } as const;
   }
   throw Error();
  }
  return { page: parseAdminPaymentJournalPage(command, value) } as const;
 };
}
export const loadAdminPaymentJournal = createAdminPaymentJournalClient((...args) => fetch(...args));
