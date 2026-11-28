/** Optional browser analytics preference only. Never authorizes an account or resource. */
export type AnalyticsConsent = 'unknown' | 'granted' | 'denied';
type Choice = Exclude<AnalyticsConsent, 'unknown'>;
export const analyticsConsentName = '__Host-blizhniy_analytics';
const channelName = 'blizhniy-analytics-consent-v1';

export function readAnalyticsConsent(cookies: string): AnalyticsConsent {
  const values = cookies.split(';').map(value => value.trim()).filter(value => value.startsWith(analyticsConsentName + '='));
  if (values.length !== 1) return 'unknown';
  if (values[0] === analyticsConsentName + '=v1.granted') return 'granted';
  if (values[0] === analyticsConsentName + '=v1.denied') return 'denied';
  return 'unknown';
}

export function analyticsConsentCookie(choice: Choice, now = Date.now()): string {
  const seconds = 31536000, expires = new Date(now + seconds * 1000);
  if ((choice !== 'granted' && choice !== 'denied') || !Number.isFinite(now) || Number.isNaN(expires.getTime())) {
    throw new Error('Invalid analytics preference');
  }
  return `${analyticsConsentName}=v1.${choice}; Path=/; Secure; SameSite=Lax; Max-Age=${seconds}; Expires=${expires.toUTCString()}`;
}

const listeners = new Set<(choice: AnalyticsConsent) => void>();
let deniedInMemory = false;
let lastNotified: AnalyticsConsent | undefined;
let channel: BroadcastChannel | null = null;
let stopObserving: (() => void) | null = null;
const inBrowser = () => typeof window !== 'undefined' && typeof document !== 'undefined';

function storedConsent(): AnalyticsConsent {
  if (!inBrowser()) return 'unknown';
  try { return readAnalyticsConsent(document.cookie); }
  catch { return 'unknown'; }
}

export function getAnalyticsConsent(): AnalyticsConsent {
  return deniedInMemory ? 'denied' : storedConsent();
}

function notify(choice: AnalyticsConsent) {
  if (lastNotified === choice) return;
  lastNotified = choice;
  for (const listener of [...listeners]) listener(choice);
}

function broadcast(choice: Choice) {
  let temporary: BroadcastChannel | null = null;
  try {
    const sender = channel ?? (typeof window.BroadcastChannel === 'function' ? temporary = new window.BroadcastChannel(channelName) : null);
    sender?.postMessage({ choice });
  } catch {
    // Focus/pageshow/visibility still recheck the persisted preference when this transport is unavailable.
    return;
  } finally { temporary?.close(); }
}

export function saveAnalyticsConsent(choice: Choice): boolean {
  if (!inBrowser() || (choice !== 'granted' && choice !== 'denied')) return false;
  if (choice === 'denied') {
    // Stop active consumers before storage access, including when an old grant cannot be overwritten.
    deniedInMemory = true;
    notify('denied');
  }
  let saved = false;
  try {
    if (choice === 'denied') clearMeasurementVisitCookie();
    document.cookie = analyticsConsentCookie(choice);
    saved = storedConsent() === choice;
  } catch { saved = false; }
  if (choice === 'denied') {
    deniedInMemory = !saved;
    broadcast('denied');
    return saved;
  }
  if (saved) {
    deniedInMemory = false;
    notify('granted');
    broadcast('granted');
  } else notify(getAnalyticsConsent());
  return saved;
}

function observe() {
  const refresh = () => notify(getAnalyticsConsent());
  const visible = () => { if (document.visibilityState === 'visible') refresh(); };
  window.addEventListener('focus', refresh);
  window.addEventListener('pageshow', refresh);
  document.addEventListener('visibilitychange', visible);
  try {
    if (typeof window.BroadcastChannel === 'function') {
      channel = new window.BroadcastChannel(channelName);
      channel.onmessage = (event: MessageEvent<unknown>) => {
        const message = event.data;
        if (!message || typeof message !== 'object' || !('choice' in message)) return;
        if (message.choice === 'denied') {
          deniedInMemory = storedConsent() !== 'denied';
          notify('denied');
        } else if (message.choice === 'granted') {
          // A message alone never grants consent. Failed revocation stays denied until a local confirmed choice.
          refresh();
        }
      };
    }
  } catch { channel = null; }
  return () => {
    window.removeEventListener('focus', refresh);
    window.removeEventListener('pageshow', refresh);
    document.removeEventListener('visibilitychange', visible);
    channel?.close(); channel = null;
  };
}

/** Immediately reports the current safe state; subsequent notifications contain changes only. */
export function subscribeAnalyticsConsent(listener: (choice: AnalyticsConsent) => void): () => void {
  if (!inBrowser()) { listener('unknown'); return () => undefined; }
  listeners.add(listener);
  if (listeners.size === 1) stopObserving = observe();
  const current = getAnalyticsConsent(), previous = lastNotified;
  notify(current);
  if (previous === current) listener(current);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) { stopObserving?.(); stopObserving = null; lastNotified = undefined; }
  };
}

const cookieName = '__Host-blizhniy_analytics_visit';
const attributes = '; Path=/; Secure; SameSite=Lax';

export function readMeasurementVisitCookie(cookies: string): string | null {
  const matching = cookies.split(';').map(value => value.trim()).filter(value => value.startsWith(cookieName + '='));
  const value = matching.length === 1 ? matching[0].slice(cookieName.length + 1) : '';
  return /^[a-f0-9]{32}$/.test(value) ? value : null;
}

/** Independent from session, payment, account and device identifiers. */
export function ensureMeasurementVisitCookie(): boolean {
  try {
    if (readMeasurementVisitCookie(document.cookie)) return true;
    const visit = Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('');
    document.cookie = cookieName + '=' + visit + attributes + '; Max-Age=86400';
    return readMeasurementVisitCookie(document.cookie) === visit;
  } catch { return false; }
}

function clearMeasurementVisitCookie() {
  try {
    if (readMeasurementVisitCookie(document.cookie)) document.cookie = cookieName + '=' + attributes + '; Max-Age=0';
  } catch { /* Revocation of consent can still proceed. */ }
}
