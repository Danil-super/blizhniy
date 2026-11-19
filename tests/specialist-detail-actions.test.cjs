const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const React = require('react');
const {renderToStaticMarkup} = require('react-dom/server');
const ts = require('typescript');

function render(contacts, publicPage) {
  const deps = {
    'react/jsx-runtime': require('react/jsx-runtime'),
    'lucide-react': require('lucide-react'),
    'next/link': ({href, children}) => React.createElement('a', {href}, children),
    '@/components/BackLink': {BackLink: () => null},
    '@/components/DetailImageGallery': {DetailImageGallery: () => null},
    '@/components/LocationMap': {LocationMap: () => null},
    '@/lib/publication-time': {formatPublicationDateTime: () => ''},
  };
  const out = {};
  const source = fs.readFileSync('src/components/SpecialistProfileDetail.tsx', 'utf8');
  const {outputText} = ts.transpileModule(source, {compilerOptions: {module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop:true}});
  new Function('exports','require',outputText)(out, name => {assert.ok(Object.hasOwn(deps,name), name);return deps[name];});
  return renderToStaticMarkup(React.createElement(out.SpecialistProfileDetail, {
    publicPage, specialist:{id:'fixture',name:'Иван',status:'published',profession:'Сварщик',price:'1500',city:'Ейск',...contacts},
  }));
}

test('public specialist without direct contacts offers a general order and private preview does not', () => {
  const html = render({},true);
  assert.match(html,/href="\/rabota\/zakazy\/sozdat"[^>]*>Разместить заказ</);
  assert.doesNotMatch(html,/Связаться|Позвонить|Написать/);
  assert.doesNotMatch(render({},false),/Связаться|Разместить заказ/);
});

test('specialist with a published contact keeps its direct action', () => {
  for (const [contacts,href] of [[{phone:'+79990000000'},'tel:+79990000000'],[{email:'contact@example.invalid'},'mailto:contact@example.invalid'],[{messengerUrl:'https://t.me/example'},'https://t.me/example']]) {
    const html = render(contacts,true);
    assert.ok(html.includes('href="'+href+'"'));
    assert.match(html,/Связаться/);
    assert.doesNotMatch(html,/Разместить заказ/);
  }
});
