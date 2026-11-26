export type MetricaPage = { url: string; referer: string; title: string };

const publicPages = new Set([
  '/', '/katalog', '/poisk', '/obyavleniya', '/o-proekte', '/kak-rabotaet',
  '/tarify', '/rekvizity', '/legal/offer', '/legal/privacy', '/legal/agreement',
  '/legal/user-agreement', '/rabota', '/rabota/vakansii', '/rabota/zakazy',
  '/rabota/specialisty', '/krasnodar', '/krasnodar/prodam', '/krasnodar/kuplyu',
  '/krasnodar/arenda', '/krasnodar/otdam-darom', '/krasnodar/rabota',
  '/krasnodar/rabota/vakansii', '/krasnodar/rabota/specialisty',
]);
const privateSegments = new Set(['auth', 'cabinet', 'admin', 'api', 'oplata', 'razmestit', 'sozdat', 'edit', 'redaktirovat', 'anketa', 'zayavka']);

/** Explicit public routes only. Card views are aggregated without publishing record or seller IDs. */
export function metricaPublicPath(pathname: string): string | null {
  if (pathname.length > 1024 || !pathname.startsWith('/') || pathname.includes('\\')) return null;
  let decoded: string;
  try { decoded = decodeURIComponent(pathname); } catch { return null; }
  if (/[\u0000-\u0020\u007f?#%]/.test(decoded) || decoded.includes('//')) return null;
  const path = decoded.length > 1 ? decoded.replace(/\/$/, '') : decoded;
  const segments = path.split('/').filter(Boolean);
  if (segments.some(segment => privateSegments.has(segment.toLowerCase()) || segment === '.' || segment === '..')) return null;
  if (publicPages.has(path)) return path;
  if (/^\/katalog\/[a-z0-9-]+$/.test(path)) return '/katalog/category';
  if (/^\/katalog\/[a-z0-9-]+\/[a-z0-9-]+$/.test(path)) return '/katalog/category/subcategory';
  if (/^\/(?:krasnodar\/)?rabota\/specialisty\/[a-z0-9-]+$/.test(path)) return '/rabota/specialisty/category';
  if (/^\/obyavlenie\/[^/]+$/.test(path)) return '/obyavlenie/card';
  if (/^\/vakansiya\/[^/]+$/.test(path)) return '/vakansiya/card';
  if (/^\/specialist\/[^/]+$/.test(path)) return '/specialist/card';
  if (/^\/prodavets\/[^/]+$/.test(path)) return '/prodavets/profile';
  if (/^\/(?:krasnodar\/)?rabota\/(?:zakazy|orders)\/[^/]+$/.test(path)) return '/rabota/zakazy/card';
  return null;
}

function safeReferer(value: string, origin: string): string {
  if (!value) return '';
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return '';
    if (url.origin !== origin) return url.origin + '/';
    const path = metricaPublicPath(url.pathname);
    return path ? origin + path : '';
  } catch { return ''; }
}

/** No search input, URL fragments, contact details or private paths cross this boundary. */
export function metricaPage(href: string, siteUrl: string, referer = ''): MetricaPage | null {
  try {
    const site = new URL(siteUrl), current = new URL(href);
    if (site.protocol !== 'https:' || site.username || site.password || site.pathname !== '/' || site.search || site.hash ||
      current.origin !== site.origin || current.username || current.password) return null;
    const path = metricaPublicPath(current.pathname);
    if (!path) return null;
    // Authentication/payment links must never become public analytics even on a mistyped public route.
    for (const key of current.searchParams.keys()) {
      if (/token|password|secret|email|phone|payment|session|(?:^|_)code(?:$|_)/i.test(key)) return null;
    }
    return { url: site.origin + path, referer: safeReferer(referer, site.origin), title: 'Ближний' };
  } catch { return null; }
}
