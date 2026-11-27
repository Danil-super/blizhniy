'use client';
import { useEffect, useRef } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { documentCspNonce } from '@/lib/client-csp-nonce';
import { ensureMeasurementVisitCookie, getAnalyticsConsent, subscribeAnalyticsConsent } from '@/lib/analytics-consent';
import { createMetricaController, type MetricaCommand } from '@/lib/metrica-controller';
import { metricaPage, measurementReferrer } from '@/lib/metrica-page';
import type { MetricaTransport } from '@/lib/metrica-config';

type QueuedCommand = MetricaCommand & { a?: unknown[][]; l?: number };
type MetricaWindow = Window & { ym?: QueuedCommand };
let library: Promise<MetricaCommand> | undefined;

function loadLibrary(): Promise<MetricaCommand> {
  if (library) return library;
  library = new Promise((resolve, reject) => {
    const nonce = documentCspNonce();
    if (!nonce) { reject(new Error('Analytics requires the document nonce')); return; }
    const scope = window as MetricaWindow;
    if (scope.ym) { reject(new Error('Analytics is already managed by another integration')); return; }
    const queued: QueuedCommand = (...args) => { (queued.a ??= []).push(args); };
    queued.l = Date.now(); scope.ym = queued;
    const script = document.createElement('script');
    script.id = 'blizhniy-yandex-metrica'; script.async = true;
    script.crossOrigin = 'anonymous';
    script.src = 'https://mc.yandex.ru/metrika/tag.js';
    script.nonce = nonce; script.referrerPolicy = 'no-referrer';
    script.onload = () => {
      if (typeof scope.ym !== 'function') { reject(new Error('Analytics unavailable')); return; }
      resolve((...args) => scope.ym?.(...args));
    };
    script.onerror = () => { reject(new Error('Analytics library unavailable')); };
    document.head.appendChild(script);
  });
  return library;
}

function createMeasurementCommand(): MetricaCommand {
  const pending = new Set<AbortController>();
  return (_counterId, method, value, options) => {
    if (method === 'destruct') {
      for (const request of pending) request.abort();
      pending.clear();
      return;
    }
    if (method !== 'hit' || typeof value !== 'string' || !ensureMeasurementVisitCookie()) return;
    const page = new URL(value);
    const referrer = measurementReferrer((options as { referer: string }).referer, page.origin);
    const request = new AbortController();
    pending.add(request);
    void fetch('/api/analytics/pageview', {
      method: 'POST', credentials: 'same-origin', referrerPolicy: 'strict-origin', redirect: 'error',
      headers: { 'Content-Type': 'application/json', 'X-Blizhniy-Request': '1' },
      body: JSON.stringify({ path: page.pathname, referrer }),
      signal: request.signal,
    }).catch(() => undefined).finally(() => pending.delete(request));
  };
}

/** Optional public-page analytics. An unavailable counter never blocks application features. */
export function YandexMetrica({ counterId, siteUrl, transport }: {
  counterId: number | null; siteUrl: string; transport: MetricaTransport | null;
}) {
  const pathname = usePathname(), search = useSearchParams();
  const controller = useRef<ReturnType<typeof createMetricaController> | null>(null);
  useEffect(() => {
    if (counterId === null || transport === null) return;
    let cancelled = false;
    let unsubscribe: (() => void) | undefined;
    const refresh = () => controller.current?.refresh();
    // StrictMode can cancel the first setup before it loads any external code.
    queueMicrotask(() => {
      if (cancelled) return;
      const lifecycle = document as Document & { prerendering?: boolean };
      const load = transport === 'measurement-protocol' ? async () => createMeasurementCommand() : loadLibrary;
      controller.current = createMetricaController(counterId, { load, snapshot: () => ({
        consent: getAnalyticsConsent() === 'granted',
        page: lifecycle.prerendering ? null : metricaPage(window.location.href, siteUrl, document.referrer),
        viewKey: window.location.pathname,
      }) });
      unsubscribe = subscribeAnalyticsConsent(refresh);
      lifecycle.addEventListener('prerenderingchange', refresh);
      window.addEventListener('hashchange', refresh);
      window.addEventListener('pageshow', refresh);
      refresh();
    });
    return () => {
      cancelled = true; unsubscribe?.(); controller.current?.dispose(); controller.current = null;
      document.removeEventListener('prerenderingchange', refresh);
      window.removeEventListener('hashchange', refresh); window.removeEventListener('pageshow', refresh);
    };
  }, [counterId, siteUrl, transport]);
  useEffect(() => { controller.current?.refresh(); }, [pathname, search]);
  return null;
}
