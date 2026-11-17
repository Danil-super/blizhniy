import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {test} from 'node:test';
import sharp from 'sharp';
import * as image from '../src/lib/media-image.ts';
import * as parser from '../src/lib/legacy-request-body.ts';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const owner = '11111111-1111-4111-8111-111111111111';
function load(path, dependencies) {
  const source = readFileSync(new URL(path, import.meta.url), 'utf8');
  const {outputText} = ts.transpileModule(source, {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}});
  const exports = {};
  new Function('require', 'exports', outputText)(name => {
    assert.ok(Object.hasOwn(dependencies, name), 'Unexpected dependency '+name);
    return dependencies[name];
  }, exports);
  return exports;
}

function fixture(storageFailure) {
  const calls = [];
  const storage = load('../src/lib/storage-upload.ts', {
    '@/lib/server-request-timeout': {}, '@/lib/supabase-rest': {}
  });
  const route = load('../src/app/api/uploads/media/route.ts', {
    'next/server': {NextResponse:Response},
    '@/lib/legacy-request-body': parser,
    '@/lib/media-image': image,
    '@/lib/server-auth': {isSupabaseServerConfigured:()=>true,getAuthenticatedRequestUser:async()=>({user:{id:owner}})},
    '@/lib/storage-upload': {...storage, canUploadMediaToStorage:()=>true, uploadMediaFile:async (file, folder, userId)=>{
      calls.push({name:file.name,folder,userId});
      if (storageFailure) throw storageFailure;
      return {path:file.name,mimeType:file.type,size:file.size,publicUrl:'https://static.invalid/'+file.name};
    }}
  });
  const send = entries => {
    const form = new FormData();
    form.append('folder','listings');
    for (const entry of entries) form.append('files',entry);
    return route.POST(new Request('https://site.invalid/api/uploads/media',{method:'POST',body:form}));
  };
  return {send,calls};
}

test('legacy photo batches validate every selection before the first storage write', async () => {
  const png = await sharp({create:{width:3,height:4,channels:3,background:'red'}}).png().toBuffer();
  const photo = new File([png],'first.png',{type:'image/png'});
  const {send,calls} = fixture();
  for (const invalid of [new File([png],'wrong.jpg',{type:'image/jpeg'}),new File([],'empty.png',{type:'image/png'}),'text']) {
    const response = await send([photo,invalid]);
    assert.equal(response.status,400);
    assert.deepEqual(calls,[]);
  }
  const entries = [];
  for (const format of ['jpeg','png','webp','gif']) {
    const bytes = await sharp(png)[format]().toBuffer();
    entries.push(new File([bytes], 'photo.'+format, {type:'image/'+format}));
  }
  const response = await send(entries);
  assert.equal(response.status,201);
  assert.deepEqual((await response.json()).files.map(file=>file.path),entries.map(file=>file.name));
  assert.deepEqual(calls,entries.map(file=>({name:file.name,folder:'listings',userId:owner})));
});

test('a storage failure returns a retryable response with a generic message', async () => {
  const {send} = fixture(new Error('synthetic private storage detail'));
  const bytes = await sharp({create:{width:2,height:2,channels:3,background:'blue'}}).png().toBuffer();
  const response = await send([new File([bytes],'photo.png',{type:'image/png'})]);
  assert.equal(response.status,502);
  assert.deepEqual(await response.json(), {error:'Не удалось загрузить фотографии. Повторите попытку.'});
});
