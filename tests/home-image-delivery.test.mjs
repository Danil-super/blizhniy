import assert from 'node:assert/strict';
import {readFileSync,statSync} from 'node:fs';
import {createRequire} from 'node:module';
import {basename} from 'node:path';
import test from 'node:test';
const require=createRequire(import.meta.url),ts=require('typescript');
const {renderToStaticMarkup}=require('react-dom/server');
function load(name){
 const source=readFileSync(new URL('../src/components/'+name+'.tsx',import.meta.url),'utf8');
 const js=ts.transpileModule(source,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
 const module={exports:{}};
 new Function('require','module','exports',js)(id=>{
  if(id.endsWith('.webp'))return{src:'/_next/static/media/'+basename(id),width:1672,height:941};
  if(id==='@/lib/category-store')return{getPublicCategories:async()=>[{slug:'zhivotnye',name:'Животные'},{slug:'sad-i-rasteniya',name:'Сад'},{slug:'uslugi-dlya-doma',name:'Услуги'}]};
  return require(id);
 },module,module.exports);return module.exports;
}
test('hero text is rendered before scripts and one responsive picture loads eagerly',()=>{
 const html=renderToStaticMarkup(load('HomeIntro').HomeIntro());
 assert.doesNotMatch(html,/\sstyle=/i,'Homepage markup must work with inline styles disabled');
 assert.match(html,/Все нужное рядом/);assert.match(html,/<picture/);assert.equal((html.match(/<img /g)??[]).length,1);
 assert.match(html,/fetchPriority="high"/i);assert.match(html,/loading="eager"/);
 assert.match(html,/media="\(min-width: 1024px\)"/);assert.match(html,/srcSet=/i);
 assert.doesNotMatch(html,/home-hero-(?:main|desktop)\.png|background-image/);
});
test('every category including the final odd card is lazy and uses responsive WebP sources',async()=>{
 const html=renderToStaticMarkup(await load('CategoryGrid').CategoryGrid({}));
 assert.doesNotMatch(html,/\sstyle=/i,'Homepage markup must work with inline styles disabled');
 const images=html.match(/<img [^>]+>/g)??[];assert.equal(images.length,3);
 for(const image of images){assert.match(image,/loading="lazy"/);assert.match(image,/srcSet=/i);assert.match(image,/sizes=/);assert.doesNotMatch(image,/fetchPriority="high"/i);assert.match(image,/\.webp/);}
 assert.match(html,/Животные/);assert.match(html,/Услуги/);assert.doesNotMatch(html,/services\.png/);
});
test('both unoptimized hero source files are real WebP and remain below300KiB',()=>{
 for(const name of ['home-hero-main','home-hero-desktop']){
  const file=new URL('../public/images/categories/'+name+'.webp',import.meta.url),bytes=readFileSync(file);
  assert.equal(bytes.toString('ascii',0,4),'RIFF');assert.equal(bytes.toString('ascii',8,12),'WEBP');assert.ok(statSync(file).size<300*1024);
 }
});

test('only the first image on the catalog landing page loads with high priority', async () => {
  const {CategoryGrid} = load('CategoryGrid');
  const html = renderToStaticMarkup(await CategoryGrid({variant: 'grid'}));
  const images = html.match(/<img [^>]+>/g) ?? [];
  assert.equal(images.length, 3);
  assert.match(images[0], /loading="eager"/);
  assert.match(images[0], /fetchPriority="high"/i);
  for (const image of images.slice(1)) {
    assert.match(image, /loading="lazy"/);
    assert.doesNotMatch(image, /fetchPriority="high"/i);
  }
});

test('category previews load entirely from versioned static files at every size', async () => {
  const {CategoryGrid} = load('CategoryGrid');
  const html = renderToStaticMarkup(await CategoryGrid({variant: 'grid'}));
  const images = html.match(/<img [^>]+>/g) ?? [];
  assert.equal(images.length, 3);
  for (const image of images) {
    assert.doesNotMatch(image, /\/_next\/image\?/);
    const candidates = image.match(/srcSet="([^"]+)"/i)[1].split(', ');
    assert.equal(candidates.length, 3);
    for (const [index, width] of [640, 1080, 1672].entries()) {
      const [src, descriptor] = candidates[index].split(' ');
      assert.match(src, /^\/_next\/static\/media\/[\w.-]+\.webp$/);
      assert.equal(descriptor, width + 'w');
    }
  }
});
