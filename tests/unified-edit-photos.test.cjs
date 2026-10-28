const assert = require('node:assert/strict');
const { readFileSync, existsSync } = require('node:fs');
const { dirname, resolve } = require('node:path');
const test = require('node:test');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const ts = require('typescript');

const root = resolve(__dirname, '..');
const owner = '11111111-1111-4111-8111-111111111111';
const photos = [1, 2, 3].map(index => ({
  id: `22222222-2222-4222-8222-${String(index).padStart(12, '0')}`,
  position: index - 1,
  contentType: 'image/png',
  byteLength: 128,
  width: 1200,
  height: 900,
}));

function componentLoader(profile=null) {
  const cache = new Map();
  function load(relative) {
    const base = resolve(root, relative);
    const file = [base, `${base}.tsx`, `${base}.ts`].find(candidate => existsSync(candidate));
    if (!file) throw new Error(`Cannot resolve ${relative}`);
    if (cache.has(file)) return cache.get(file);
    const exports = {};
    cache.set(file, exports);
    const code = ts.transpileModule(readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
    }).outputText;
    new Function('require', 'exports', code)(name => {
      if (name === '@/components/FormPanel') return {
        Field: () => null,
        TextAreaField: () => null,
        PhotoField: props => React.createElement(load('src/components/FormPhotoUploader').FormPhotoUploader, props),
      };
      if (name.endsWith('/useWorkPublicationSave')) return { useWorkPublicationSave: () => ({ active: false, done: false, busy: false, uncertain: false, start() {} }) };
      if (name.endsWith('/useServicePublicationSave')) return { useServicePublicationSave: () => ({ active: false, done: false, busy: false, uncertain: false, start() {} }) };
      if (name.endsWith('/ListingWorkflowProvider')) return { useListingPostmoderation: () => true,useLocalPaymentSimulation:()=>true };
      if (name.endsWith('/AccountAuthProvider')) return { usePrimaryAccountAuth: () => ({ state: 'signed-in', userId: owner }) };
      if (name.endsWith('/CookieCabinetProfileProvider')) return { useCookieCabinetProfile: () => profile?{ownerId:owner,profile}:null };
      if (name === '@/components/VacancyEmployerFields') return { VacancyEmployerFields: ({ children }) => children };
      if (name === './VacancyEmployerFlow') return { VacancyEmployerFlow: ({ children, actions }) => React.createElement(React.Fragment, null, children, actions) };
      if (name.endsWith('/ListingFormControls')) return { ListingLocationFields: () => null };
      if (name.endsWith('/LegalConsentCheckbox')) return { LegalConsentCheckbox: () => null, LegalLink: () => null };
      if (name.endsWith('/PrivateDraftEditor')) return { draftButton: 'button' };
      if (name === './WorkAmountField') return { WorkAmountField: () => null };
      if (name === './ProfessionSelect') return { ProfessionSelect: () => null };
      if (name === './VacancyTermsFields') return { VacancyTermsFields: () => null };
      if (name.endsWith('/SquareImageCropper')) return { SquareImageCropper: () => null };
      if (name.endsWith('/StoredMedia')) return { StoredMediaImage: ({ src, alt, ...props }) => React.createElement('img', { src, alt, ...props }) };
      if (name === '@/lib/data') return { professions: [], fairCategories: [] };
      if (name.endsWith('/client-listing-media')) return { productionListingMedia: { read() { throw new Error('SSR must never fetch private photo bytes'); } } };
      if (name.startsWith('@/')) return load(`src/${name.slice(2)}`);
      if (name.startsWith('.')) return load(resolve(dirname(file), name));
      return require(name);
    }, exports);
    return exports;
  }
  return load;
}

for (const [kind, maxPhotos] of [['workRequest', 6], ['vacancy', 12]]) {
  test(`${kind} editing includes all saved photos in one shared photo count and limit`, () => {
    const load = componentLoader();
    const { WorkPublicationForm } = load('src/components/work/WorkPublicationForm');
    const initial = { id: owner, kind, revision: '2', status: 'draft', paid: false, photos,
      form: { kind, title: 'Сохранённая публикация', professionName: 'Сантехник', cityName: 'Крымск', description: 'Описание', placementRightConfirmed: true } };
    const html = renderToStaticMarkup(React.createElement(WorkPublicationForm, { owner, kind, initial }));
    assert.match(html, new RegExp(`3/${maxPhotos}`), 'saved photos must be included in the visible counter, not shown as zero');
    assert.doesNotMatch(html, /Оставить фото/, 'saved and new photos must not use contradictory separate editors');
  });
}

for (const [kind, maxPhotos] of [['specialist', 12], ['fair', 10]]) {
  test(`${kind} editing uses profile identity for specialist and the shared media editor for fair`, () => {
    const profile={name:'Анна-Мария',avatarDataUrl:'data:image/png;base64,AAAA'};
    const load = componentLoader(kind==='specialist'?profile:null);
    const { ServicePublicationForm } = load('src/components/services/ServicePublicationForm');
    const initial = { id: owner, kind, revision: '2', status: 'draft', paid: false, photos,
      form: { kind, title: 'Сохранённый материал', professionName: 'Сантехник', cityName: 'Крымск', description: 'Описание материала', placementRightConfirmed: true } };
    const html = renderToStaticMarkup(React.createElement(ServicePublicationForm, { owner, kind, initial, onSaved() {} }));
    if(kind==='specialist'){
      assert.match(html,/Анна-Мария/);
      assert.match(html,/src="data:image\/png;base64,AAAA"/);
      assert.match(html,/type="hidden" name="title" value="Анна-Мария"/);
      assert.doesNotMatch(html,/type="file"|name="keepPhotoIds"|name="district"|name="videoUrl"/);
      assert.doesNotMatch(html,/Имя или название/);
    }else{
    assert.match(html, new RegExp(`3/${maxPhotos}`), 'saved photos must contribute to the same visible counter as new uploads');
    assert.doesNotMatch(html, /Оставить фото/, 'one photo editor must own retention and edits');
    }
  });
}

test('photo uploader baseline counts persisted previews and does not submit unchanged photos as new files', () => {
  const load = componentLoader();
  const { FormPhotoUploader } = load('src/components/FormPhotoUploader');
  const html = renderToStaticMarkup(React.createElement(FormPhotoUploader, {
    label: 'Фотографии', description: 'Фото объявления', maxPhotos: 6,
    defaultPhotos: ['https://example.invalid/first.png', 'https://example.invalid/second.png'],
  }));
  assert.match(html, /2\/6/);
  assert.equal((html.match(/name="existingPhotos"/g) ?? []).length, 2);
  assert.equal((html.match(/type="file"/g) ?? []).length, 1);
});

test('private saved media contributes to the uploader count before any preview network request', () => {
  const load = componentLoader();
  const { FormPhotoUploader } = load('src/components/FormPhotoUploader');
  const html = renderToStaticMarkup(React.createElement(FormPhotoUploader, {
    label: 'Фотографии', description: 'Фото заказа', maxPhotos: 6,
    savedMedia: { owner, photos },
  }));
  assert.match(html, /3\/6/, 'private metadata is enough to render an accurate initial count');
  assert.equal((html.match(/name="keepPhotoIds"/g) ?? []).length, 3, 'unchanged saved media must stay retained in the form');
  assert.equal((html.match(/type="file"/g) ?? []).length, 1, 'one input owns all newly added photos');
});

test('private saved media at the maximum is represented by the full shared capacity, not an empty new-file allowance', () => {
  const load = componentLoader();
  const { FormPhotoUploader } = load('src/components/FormPhotoUploader');
  const html = renderToStaticMarkup(React.createElement(FormPhotoUploader, {
    label: 'Фотографии', description: 'Фото заказа', maxPhotos: 3,
    savedMedia: { owner, photos },
  }));
  assert.match(html, /3\/3/);
  assert.doesNotMatch(html, /0\/3/);
});
