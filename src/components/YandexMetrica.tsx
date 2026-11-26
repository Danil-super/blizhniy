'use client';
import { useEffect, useRef } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { documentCspNonce } from '@/lib/client-csp-nonce';
import { getAnalyticsConsent, subscribeAnalyticsConsent } from '@/lib/analytics-consent';
import { createMetricaController, type MetricaCommand } from '@/lib/metrica-controller';
import { metricaPage } from '@/lib/metrica-page';

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

/** Optional public-page analytics. An unavailable counter never blocks application features. */
export function YandexMetrica({ counterId, siteUrl }: { counterId: number | null; siteUrl: string }) {
  const pathname = usePathname(), search = useSearchParams();
  const controller = useRef<ReturnType<typeof createMetricaController> | null>(null);
  useEffect(() => {
    if (counterId === null) return;
    let cancelled = false;
    let unsubscribe: (() => void) | undefined;
    const refresh = () => controller.current?.refresh();
    // StrictMode can cancel the first setup before it loads any external code.
    queueMicrotask(() => {
      if (cancelled) return;
      controller.current = createMetricaController(counterId, { load: loadLibrary, snapshot: () => ({
        consent: getAnalyticsConsent() === 'granted',
        page: metricaPage(window.location.href, siteUrl, document.referrer),
        viewKey: window.location.pathname,
      }) });
      unsubscribe = subscribeAnalyticsConsent(refresh);
      window.addEventListener('hashchange', refresh);
      window.addEventListener('pageshow', refresh);
      refresh();
    });
    return () => {
      cancelled = true; unsubscribe?.(); controller.current?.dispose(); controller.current = null;
      window.removeEventListener('hashchange', refresh); window.removeEventListener('pageshow', refresh);
    };
  }, [counterId, siteUrl]);
  useEffect(() => { controller.current?.refresh(); }, [pathname, search]);
  return null;
}
