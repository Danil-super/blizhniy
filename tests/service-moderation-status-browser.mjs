// Exercise effect replay and late replies with the installed React renderer and controlled moderation calls.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {dirname, join} from 'node:path';
import {test} from 'node:test';
import {chromium} from 'playwright';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const source = await readFile(new URL('../src/components/services/ServiceModerationStatus.tsx', import.meta.url), 'utf8');
const component = ts.transpileModule(source, {compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX
}}).outputText;

async function loadModule(page, name, code) {
  await page.addScriptTag({content: '(function(exports,require){' + code + '\n})(window.modules[' +
    JSON.stringify(name) + ']={}, name => {if (!(name in window.modules)) throw Error(name); return window.modules[name]});'});
}

test('moderation reads and submissions belong to the displayed revision', async suite => {
  const browser = await chromium.launch();
  try {
    for (const strict of [true, false]) await suite.test(strict ? 'StrictMode effect replay' : 'change revision during submission', async () => {
      const page = await browser.newPage();
      try {
        await page.route('**/*', route => route.abort());
        await page.setContent('<main id="root"></main>');
        const mode = strict ? 'development' : 'production';
        await page.evaluate(mode => { window.modules = {}; window.process = {env: {NODE_ENV: mode}}; }, mode);
        for (const [name, pkg, file] of [
          ['scheduler','scheduler','scheduler'], ['react','react','react'],
          ['react-dom','react-dom','react-dom'], ['react-dom/client','react-dom','react-dom-client'],
          ['react/jsx-runtime','react','react-jsx-runtime']
        ]) await loadModule(page, name, await readFile(join(dirname(require.resolve(pkg + '/package.json')), 'cjs', file + '.' + mode + '.js'), 'utf8'));
        await page.evaluate(() => {
          window.calls = [];
          const request = (action, owner, kind, id, revision, {signal}) => new Promise(resolve => {
            window.calls.push({action, revision, signal, resolve});
          });
          Object.assign(window.modules, {
            'next/link': {default: 'a'},
            '@/components/listings/ListingWorkflowProvider': {useSpecialistCheckout: () => true, useServiceCheckout: () => false},
            '@/components/listings/PrivateListingCheckout': {PrivateListingCheckout: () => 'Оплатить анкету'},
            '@/lib/client-service-publications': {serviceModeration: {
              read: (...args) => request('read', ...args), submit: (...args) => request('submit', ...args)
            }},
            '@/components/listings/PrivateDraftEditor': {draftButton: ''}
          });
        });
        await loadModule(page, 'component', component);
        await page.evaluate(strict => {
          const {createElement: h, StrictMode, Fragment} = window.modules.react;
          const root = window.modules['react-dom/client'].createRoot(document.querySelector('main'));
          window.showRevision = (revision, change = {}) => root.render(h(strict ? StrictMode : Fragment, null,
            h(window.modules.component.ServiceModerationStatus, {owner: 'owner', snapshot: {
              kind: 'specialist', id: 'profile', revision, status: 'draft', paid: false, publishedAt: null, expiresAt: null, ...change
            }})));
          window.showRevision('1');
        }, strict);
        if (strict) {
          await page.waitForFunction(() => window.calls.length === 2, null, {timeout: 3000});
          assert.deepEqual(await page.evaluate(() => window.calls.map(c => c.signal.aborted)), [true, false]);
          await page.evaluate(() => { window.calls[1].resolve({state: 'approved'}); window.calls[0].resolve({state: 'rejected'}); });
        } else {
          await page.waitForFunction(() => window.calls.length === 1);
          await page.evaluate(() => window.calls[0].resolve({state: 'not_submitted'}));
          await page.getByRole('button', {name: 'Отправить на модерацию'}).click();
          await page.waitForFunction(() => window.calls[1]?.action === 'submit');
          await page.evaluate(() => window.showRevision('2'));
          await page.waitForFunction(() => window.calls[2]?.revision === '2', null, {timeout: 3000});
          await page.evaluate(async () => {
            window.calls[1].resolve({state: 'approved'});
            await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
          });
          assert.equal(await page.getByRole('button', {name: 'Обновить статус модерации'}).isDisabled(), true);
          assert.equal(await page.getByText('Оплатить анкету').count(), 0);
          await page.evaluate(() => window.calls[2].resolve({state: 'approved'}));
        }
        await page.getByText('Оплатить анкету').waitFor({timeout: 3000});
        assert.equal(await page.getByRole('button', {name: 'Обновить статус модерации'}).isEnabled(), true);
        await page.evaluate(revision => window.showRevision(revision, {status: 'expired', paid: true,
          publishedAt: '2026-10-24T12:00:00Z', expiresAt: '2026-11-23T12:00:00Z'}), strict ? '1' : '2');
        await page.getByText('Срок размещения истёк.', {exact: true}).waitFor({timeout: 3000});
        assert.equal(await page.getByText('Оплатить анкету').count(), 0);
      } finally { await page.close(); }
    });
  } finally { await browser.close(); }
});
