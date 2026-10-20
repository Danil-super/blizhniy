"use client";
import {parseListingDraftId} from './listing-draft-contract.ts';
import {parseAdminOverview} from './admin-overview-contract.ts';
export class AdminOverviewClientError extends Error {
  readonly code: string;
  constructor(code: string) {
    super(code === 'ADMIN_REQUIRED' || code === 'UNAUTHENTICATED' ? 'Доступ администратора не подтверждён. Войдите заново.' :
      code === 'RATE_LIMITED' ? 'Слишком много запросов. Повторите позже.' : 'Не удалось загрузить обзор. Проверьте соединение и повторите.'); this.code = code;
  }
}
export function createAdminOverviewClient(transport: typeof fetch) {
  return {async read(actor: string, options: {signal?: AbortSignal} = {}) {
    try {
      const expectedAdminId = parseListingDraftId(actor), timeout = AbortSignal.timeout(15000);
      const signal = options.signal ? AbortSignal.any([timeout, options.signal]) : timeout; signal.throwIfAborted();
      const response = await transport('/api/admin/overview', {method: 'POST', credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal,
        headers: {'Content-Type': 'application/json', 'X-Blizhniy-Request': '1'}, body: JSON.stringify({expectedAdminId})});
      if (!response.body) throw Error();
      const reader = response.body.getReader(), parts: Uint8Array[] = []; let size = 0, complete = false;
      try {for (;;) {
        signal.throwIfAborted(); const part = await reader.read(); signal.throwIfAborted();
        if (part.done) {complete = true; break;} size += part.value.byteLength;
        if (size > 16384 || parts.length >= 1024) throw Error(); parts.push(part.value);
      }} finally {try {if (!complete) await reader.cancel();} finally {reader.releaseLock();}}
      const bytes = new Uint8Array(size); let offset = 0;
      for (const part of parts) {bytes.set(part, offset); offset += part.byteLength;}
      const value = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes));
      if (response.status !== 200) {
        const codes: Record<string, number> = {ADMIN_REQUIRED: 403, UNAUTHENTICATED: 401, RATE_LIMITED: 429};
        const code = value?.error?.code;
        throw new AdminOverviewClientError(typeof code === 'string' && Object.hasOwn(codes, code) && codes[code] === response.status ? code : 'UNKNOWN');
      }
      return parseAdminOverview(value);
    } catch (error) {if (error instanceof AdminOverviewClientError) throw error; throw new AdminOverviewClientError('UNKNOWN');}
  }};
}
export const adminOverview = createAdminOverviewClient((...args) => fetch(...args));
