import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {test} from 'node:test';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const React = require('react');
const {renderToStaticMarkup} = require('react-dom/server');
const actor = '12345678-1234-4321-8765-123456789abc';
const sections = [
  ['/admin', 'Обзор'], ['/admin/users', 'Пользователи'],
  ['/admin/account-deletion', 'Удаление аккаунтов'], ['/admin/obyavleniya', 'Объявления'],
  ['/admin/vakansii', 'Вакансии'], ['/admin/zakazy', 'Заказы'],
  ['/admin/specialisty', 'Специалисты'], ['/admin/tariffs', 'Тарифы'],
  ['/admin/payments', 'Платежи'], ['/admin/ad-marquee', 'Бегущая строка'],
  ['/admin/fair-applications', 'Ярмарка'],
];

function renderAdminPage(section, role = 'admin', mode = 'postgres') {
  const modules = new Map();
  const marker = name => function OwnedWorkspace() {return React.createElement('section', {'data-workspace': name});};
  const dependencies = {
    '@/components/SiteHeader': {SiteHeader: () => React.createElement('header', null, 'БЛИЖНИЙ')},
    '@/components/auth/AdminAuthGate': {AdminAuthGate: ({children}) => role === 'admin' ? children : React.createElement('p', null, 'Доступ закрыт')},
    '@/components/auth/AccountAuthProvider': {usePrimaryAccountAuth: () => ({state: role === 'admin' ? 'admin' : 'signed-in', userId: actor})},
    '@/lib/local-account': {notifyAccountSessionChange() { throw new Error('SSR must not trigger a session recheck'); }},
    '@/components/listings/PrivateDraftEditor': {draftButton: 'button'},
    '@/components/admin/AdminPublicationsTableClient': {AdminPublicationsTableClient: marker('legacy-publications')},
    '@/components/admin/AdminAdMarqueeClient': {AdminAdMarqueeClient: marker('legacy-marquee')},
    './ListingModerationWorkspace': {ListingModerationWorkspace: marker('primary-listings')},
    './WorkModerationWorkspace': {WorkModerationWorkspace: marker('primary-work')},
    './ServiceModerationWorkspace': {ServiceModerationWorkspace: marker('primary-services')},
    './ServicePublicationForm': {serviceFormLabels: {specialist: 'Анкеты специалистов', fair: 'Ярмарка', marquee: 'Бегущая строка'}},
  };
  function load(path) {
    if (modules.has(path)) return modules.get(path);
    const exports = {};
    modules.set(path, exports);
    const source = readFileSync(new URL(`../${path}.tsx`, import.meta.url), 'utf8');
    const code = ts.transpileModule(source, {compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
    }}).outputText;
    new Function('require', 'exports', 'process', code)(name => {
      if (['react', 'react/jsx-runtime', 'next/link', 'lucide-react'].includes(name)) return require(name);
      if (Object.hasOwn(dependencies, name)) return dependencies[name];
      if (name.startsWith('@/components/')) return load(`src/${name.slice(2)}`);
      throw new Error(`Unapproved primary admin SSR dependency: ${name}`);
    }, exports, {env: {BLIZHNIY_AUTH_MODE: mode}});
    return exports;
  }
  const Page = load(`src/app/admin/${section}/page`).default;
  return renderToStaticMarkup(React.createElement(Page));
}

for (const section of ['obyavleniya', 'vakansii', 'zakazy', 'specialisty', 'fair-applications', 'ad-marquee']) {
  test(`primary admin /${section} preserves the complete administration navigation and current section`, () => {
    const html = renderAdminPage(section);
    const nav = html.match(/<nav\b[^>]*aria-label="Разделы админки"[^>]*>(.*?)<\/nav>/s)?.[1];
    assert.ok(nav, 'The primary moderation screen must retain the common administration navigation');
    for (const [href, label] of sections) {
      assert.match(nav, new RegExp(`href="${href}"[^>]*>.*?${label}<`, 's'));
    }
    const active = nav.match(/<a\b[^>]*aria-current="page"[^>]*>/g) ?? [];
    assert.equal(active.length, 1, 'Exactly the selected section should be current');
    assert.match(active[0], new RegExp(`href="/admin/${section}"`));
    assert.equal((html.match(/<main\b/g) ?? []).length, 1, 'A moderation screen must not nest another page shell');
    assert.doesNotMatch(html, /data-workspace="legacy-/);
  });
}

test('navigation reproduction harness renders the existing local administration shell', () => {
  const html = renderAdminPage('obyavleniya', 'admin', 'local');
  const nav = html.match(/<nav\b[^>]*aria-label="Разделы админки"[^>]*>(.*?)<\/nav>/s)?.[1];
  assert.ok(nav);
  for (const [href, label] of sections) assert.match(nav, new RegExp(`href="${href}"[^>]*>.*?${label}<`, 's'));
  assert.match(html, /data-workspace="legacy-publications"/);
});

test('primary listing page never exposes the administration menu to a non-admin session', () => {
  const html = renderAdminPage('obyavleniya', 'user');
  assert.doesNotMatch(html, /aria-label="Разделы админки"/);
  assert.doesNotMatch(html, /data-workspace="primary-listings"/);
});
