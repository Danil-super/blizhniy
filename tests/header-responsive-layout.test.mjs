import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const postcss = require('postcss');
const tailwindcss = require('tailwindcss');
const root = fileURLToPath(new URL('..', import.meta.url));

// Execute the complete source tree with real React, Next links and icons.
// Only the Auth state boundary is substituted; SSR never runs client effects.
export function renderHeader(state = 'signed-in', compact = true, actionsOnly = false) {
  const cache = new Map();
  function load(filename) {
    if (cache.has(filename)) return cache.get(filename).exports;
    const module = { exports: {} }; cache.set(filename, module);
    const compiled = ts.transpileModule(readFileSync(filename, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
    }).outputText;
    const resolveLocal = value => {
      const base = value.startsWith('@/') ? path.join(root, 'src', value.slice(2)) : path.resolve(path.dirname(filename), value);
      const resolved = ['.tsx', '.ts', '/index.ts', '/index.tsx'].map(suffix => base + suffix).find(existsSync);
      if (!resolved) throw new Error(`Missing actual header dependency ${value}`);
      return load(resolved);
    };
    vm.runInNewContext(compiled, {
      module, exports: module.exports, process: { env: {} }, console, URL, setTimeout, clearTimeout,
      fetch: () => { throw new Error('Header SSR attempted I/O'); },
      require: id => id === '@/components/auth/useAuthState' ? { useAuthState: () => ({ state }) }
        : id.startsWith('@/') || id.startsWith('.') ? resolveLocal(id) : require(id),
    }, { filename });
    return module.exports;
  }
  const component = actionsOnly ? load(path.join(root, 'src/components/HeaderActions.tsx')).HeaderActions
    : load(path.join(root, 'src/components/SiteHeader.tsx')).SiteHeader;
  return renderToStaticMarkup(React.createElement(component, actionsOnly ? { compact } : {}));
}

function elements(html, tag) {
  return [...html.matchAll(new RegExp(`<${tag}\\b([^>]*)>([\\s\\S]*?)</${tag}>`, 'g'))].map(match => ({
    attributes: Object.fromEntries([...match[1].matchAll(/([\w-]+)="([^"]*)"/g)].map(attribute => [attribute[1], attribute[2]])),
    contents: match[2],
  }));
}
function byHref(html, href) { return elements(html, 'a').find(element => element.attributes.href === href); }
function firstSpan(element) { return elements(element.contents, 'span')[0]; }

// Use the project's actual Tailwind compiler/config and emitted cascade, not a
// table that assumes a utility spelling has a particular CSS effect.
const configModule = { exports: {} };
vm.runInNewContext(ts.transpileModule(readFileSync(path.join(root, 'tailwind.config.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { exports: configModule.exports, module: configModule });
const styles = postcss.parse((await postcss([tailwindcss({ ...configModule.exports.default, content: [{ raw: ['SiteHeader', 'HeaderActions', 'HeaderNav', 'HeaderControls', 'NotificationBell'].map(name => readFileSync(path.join(root, `src/components/${name}.tsx`), 'utf8')).join('\n') }] })])
  .process('@tailwind base; @tailwind components; @tailwind utilities;', { from: undefined })).css);

export function renderedHeaderCss() {
  return styles.toString() + '\n' + readFileSync(path.join(root, 'src/app/globals.css'), 'utf8');
}

function computed(element, width) {
  assert.ok(element, 'actual rendered element exists');
  const classes = new Set((element.attributes.class || '').split(/\s+/));
  const declarations = {};
  styles.walkRules(rule => {
    if (!rule.selector.startsWith('.') || rule.selector.includes(':hover') || rule.selector.includes(':focus') || rule.selector.includes(':active')) return;
    let ancestor = rule.parent;
    while (ancestor?.type !== 'root') {
      if (ancestor.type === 'atrule' && ancestor.name === 'media') {
        const minimum = /min-width:\s*(\d+)px/.exec(ancestor.params);
        if (minimum && width < Number(minimum[1])) return;
      }
      ancestor = ancestor.parent;
    }
    const selectorClass = rule.selector.slice(1).replace(/\\(.)/g, '$1');
    if (!classes.has(selectorClass)) return;
    rule.walkDecls(declaration => { declarations[declaration.prop] = declaration.value; });
  });
  return declarations;
}
const rem = value => value?.endsWith('rem') ? Number.parseFloat(value) * 16 : Number.parseFloat(value);

for (const state of ['signed-out', 'signed-in', 'admin', 'loading']) {
  test(`Header actual ${state} render keeps the native account destination and full visible caption`, () => {
    const signedOut = state === 'signed-out'; const html = renderHeader(state);
    const account = byHref(html, signedOut ? '/auth' : '/cabinet');
    assert.ok(account);
    assert.ok(account.contents.includes(signedOut ? 'Вход' : 'Кабинет'));
    assert.equal(computed(account, 320).display, 'inline-flex');
    assert.notEqual(computed(elements(account.contents, 'span')[1], 320).display, 'none');
    assert.equal((account.attributes.class || '').includes('sr-only'), false);
    assert.ok(byHref(html, '/'));
    assert.ok(elements(html, 'button').find(button => button.attributes['aria-label'] === 'Уведомления'));
  });
}

test('Header mobile account stacks the icon and readable 12px caption inside a 44px native target', () => {
  for (const state of ['signed-out', 'signed-in', 'admin', 'loading']) {
    const html = renderHeader(state); const account = byHref(html, state === 'signed-out' ? '/auth' : '/cabinet');
    const css = computed(account, 320); const caption = computed(elements(account.contents, 'span')[1], 320);
    assert.equal(css['flex-direction'], 'column');
    assert.ok(rem(css.height) >= 44); assert.ok(rem(css['min-width']) >= 44);
    assert.equal(rem(css.gap), 2);
    assert.equal(rem(computed(firstSpan(account), 320).width), 28);
    assert.equal(rem(caption['font-size']), 12); assert.equal(rem(caption['line-height']), 12);
    assert.notEqual(css.overflow, 'hidden');
  }
});

test('Header small-and-larger account and publish links retain the original horizontal composition', () => {
  const html = renderHeader(); const account = byHref(html, '/cabinet'); const publish = byHref(html, '/razmestit');
  for (const width of [640, 768, 1024, 1440]) {
    assert.equal(computed(account, width)['flex-direction'], 'row');
    assert.equal(rem(computed(account, width).gap), 6);
    assert.equal(rem(computed(firstSpan(account), width).width), 36);
    assert.equal(rem(computed(elements(account.contents, 'span')[1], width)['font-size']), 14);
    assert.equal(computed(publish, width).display, 'inline-flex');
    assert.ok(rem(computed(publish, width).height) >= 44);
  }
  assert.equal(computed(publish, 320).display, 'none', 'existing desktop-only publish placement remains unchanged');
});

test('Header brand keeps its native home link and original typography with a 44px target', () => {
  const brand = byHref(renderHeader(), '/'); const css = computed(brand, 320);
  assert.ok(rem(css['min-height']) >= 44);
  assert.equal(rem(css['font-size']), 24);
  assert.ok(brand.contents.includes('БЛИЖНИЙ'));
  assert.equal(brand.attributes['aria-label'], 'БЛИЖНИЙ, главная');
});

test('Header notification and both responsive region triggers have 44px hit areas', () => {
  const buttons = elements(renderHeader(), 'button');
  const bell = buttons.find(button => button.attributes['aria-label'] === 'Уведомления');
  assert.equal(rem(computed(bell, 320).width), 44); assert.equal(rem(computed(bell, 320).height), 44);
  const regions = buttons.filter(button => button.attributes['aria-haspopup'] === 'listbox');
  assert.equal(regions.length, 2);
  for (const trigger of regions) assert.ok(rem(computed(trigger, 320)['min-height']) >= 44);
});

test('Header desktop navigation remains native and gives every rendered link a 44px target', () => {
  for (const state of ['signed-out', 'admin']) {
    const html = renderHeader(state);
    for (const href of ['/obyavleniya', '/kak-rabotaet', '/yarmarka-masterov', ...(state === 'admin' ? ['/admin'] : [])]) {
      const link = byHref(html, href); const css = computed(link, 1440);
      assert.equal(css.display, 'inline-flex'); assert.ok(rem(css['min-height']) >= 44);
    }
  }
});

test('Noncompact HeaderActions keep the original horizontal layout and icon sizing', () => {
  const html = renderHeader('signed-in', false, true); const account = byHref(html, '/cabinet');
  assert.notEqual(computed(account, 320)['flex-direction'], 'column');
  assert.equal(rem(computed(account, 320).gap), 6);
  assert.equal(rem(computed(firstSpan(account), 320).width), 36);
  assert.equal(computed(byHref(html, '/razmestit'), 320).display, 'inline-flex');
});
