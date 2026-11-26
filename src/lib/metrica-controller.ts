import type { MetricaPage } from './metrica-page';

export type MetricaCommand = (id: number, method: 'init' | 'hit' | 'destruct', value?: unknown, options?: unknown) => void;
// viewKey distinguishes navigation between aggregated cards. It stays in memory and is never sent to ym.
export type MetricaSnapshot = { consent: boolean; page: MetricaPage | null; viewKey: string };
export const metricaInitOptions = Object.freeze({
  defer: true, webvisor: false, clickmap: false, trackLinks: false, trackHash: false,
  ecommerce: false, disableYtm: true, sendTitle: false, accurateTrackBounce: false,
});

/** Reads current consent and route again after loading; never buffers old page views. */
export function createMetricaController(id: number, dependencies: {
  load: () => Promise<MetricaCommand>; snapshot: () => MetricaSnapshot;
}) {
  let command: MetricaCommand | undefined;
  let loading = false, failed = false, disposed = false, initialized = false;
  let lastUrl: string | null = null;
  let lastViewKey: string | null = null;

  function stop() {
    lastUrl = null;
    lastViewKey = null;
    if (!initialized) return;
    initialized = false;
    try { command?.(id, 'destruct'); } catch { failed = true; }
  }
  function refresh() {
    if (disposed) return;
    const state = dependencies.snapshot();
    if (!state.consent || !state.page) { stop(); return; }
    if (failed) return;
    if (!command) {
      if (loading) return;
      loading = true;
      // Deferred invocation makes repeated refresh/mount harmless and contains loader errors.
      Promise.resolve().then(() => {
        const current = dependencies.snapshot();
        if (disposed || !current.consent || !current.page) return undefined;
        return dependencies.load();
      }).then(loaded => {
        loading = false;
        if (!loaded) return;
        command = loaded;
        refresh();
      }, () => { loading = false; failed = true; });
      return;
    }
    try {
      if (!initialized) {
        initialized = true;
        command(id, 'init', metricaInitOptions);
      }
      const latest = dependencies.snapshot();
      if (disposed || !latest.consent || !latest.page) { stop(); return; }
      if (latest.viewKey === lastViewKey) return;
      const previous = lastUrl;
      lastUrl = latest.page.url;
      lastViewKey = latest.viewKey;
      command(id, 'hit', latest.page.url, { referer: previous ?? latest.page.referer, title: latest.page.title });
    } catch { failed = true; stop(); }
  }
  return { refresh, dispose() { disposed = true; stop(); } };
}
