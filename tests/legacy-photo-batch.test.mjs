import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {createServer} from 'node:http';
import {test} from 'node:test';
import sharp from 'sharp';
import * as image from '../src/lib/media-image.ts';
import * as parser from '../src/lib/legacy-request-body.ts';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const owner = '11111111-1111-4111-8111-111111111111';
function load(path, dependencies, env = {}) {
  const source = readFileSync(new URL(path, import.meta.url), 'utf8');
  const {outputText} = ts.transpileModule(source, {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}});
  const exports = {};
  new Function('require', 'exports', 'process', outputText)(name => {
    assert.ok(Object.hasOwn(dependencies, name), 'Unexpected dependency '+name);
    return dependencies[name];
  }, exports, {env});
  return exports;
}

function fixture(storageFailure, overrides = {}, normalize = image.normalizeMediaImage) {
  const calls = [];
  const storage = load('../src/lib/storage-upload.ts', {
    '@/lib/server-request-timeout': {}, '@/lib/supabase-rest': {}
  });
  const route = load('../src/app/api/uploads/media/route.ts', {
    'next/server': {NextResponse:Response},
    '@/lib/legacy-request-body': parser,
    '@/lib/media-image': image,
    '@/lib/legacy-photo-normalizer': {getLegacyPhotoNormalizer: async () => ({normalize})},
    '@/lib/server-auth': {isSupabaseServerConfigured:()=>true,getAuthenticatedRequestUser:async()=>({user:{id:owner}})},
    '@/lib/storage-upload': {...storage, canUploadMediaToStorage:()=>true, uploadMediaFile:async (file, folder, userId)=>{
      calls.push({name:file.name,folder,userId});
      if (storageFailure) throw storageFailure;
      return {path:file.name,mimeType:file.type,size:file.size,publicUrl:'https://static.invalid/'+file.name};
    }, ...overrides}
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

test('failed batch cleans only confirmed writes including a success acknowledged after another file failed', async () => {
  const completed = Promise.withResolvers();
  const failed = Promise.withResolvers();
  const cleanup = [];
  const {send} = fixture(null, {
    async uploadMediaFile(file) {
      if (file.name === 'failed.png') {
        failed.resolve();
        throw Error('synthetic provider failure');
      }
      if (file.name === 'late.png') await completed.promise;
      return {path:'listings/'+owner+'/'+file.name,mimeType:file.type,size:file.size,publicUrl:'synthetic'};
    },
    async removeUploadedMedia(paths,folder,userId) { cleanup.push({paths,folder,userId}); }
  });
  const pixels = await sharp({create:{width:2,height:2,channels:3,background:'green'}}).png().toBuffer();
  const names = ['first.png','failed.png','late.png'];
  const pending = send(names.map(name=>new File([pixels],name,{type:'image/png'})));
  await failed.promise;
  assert.equal(cleanup.length,0);
  completed.resolve();
  const response = await pending;
  assert.equal(response.status,502);
  assert.deepEqual(cleanup,[{paths:['listings/'+owner+'/first.png','listings/'+owner+'/late.png'],folder:'listings',userId:owner}]);
});

test('partial Storage HTTP failure rolls back new objects and a retry returns readable images', async (t) => {
  const prefix = '/storage/v1/object/blizhniy-media';
  const original = 'listings/'+owner+'/previous.png';
  const objects = new Map([[original, Buffer.from('existing')]]);
  let failNextWebp = true;
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks);
    if (req.method === 'DELETE' && req.url === prefix) {
      for (const key of JSON.parse(body).prefixes) objects.delete(key);
      res.writeHead(200).end('[]');
      return;
    }
    if (req.method === 'POST' && req.url.startsWith(prefix+'/')) {
      if (failNextWebp && req.headers['content-type'] === 'image/webp') {
        failNextWebp = false;
        res.writeHead(503).end();
        return;
      }
      objects.set(req.url.slice(prefix.length+1), body);
      res.writeHead(200).end('{}');
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const storage = load('../src/lib/storage-upload.ts', {
    '@/lib/server-request-timeout': await import('../src/lib/server-request-timeout.ts'),
    '@/lib/supabase-rest': {isSupabaseServiceRoleConfigured: () => true},
  }, {NEXT_PUBLIC_SUPABASE_URL:'http://127.0.0.1:'+server.address().port, SUPABASE_SERVICE_ROLE_KEY:'fixture'});
  const {send} = fixture(null, storage);
  const image = sharp({create:{width:3,height:2,channels:3,background:'navy'}});
  const files = await Promise.all(['png','webp'].map(async format =>
    new File([await image.clone().toFormat(format).toBuffer()], 'image.'+format, {type:'image/'+format})
  ));

  assert.equal((await send(files)).status, 502);
  assert.deepEqual([...objects.keys()], [original]);
  const retry = await send(files);
  assert.equal(retry.status, 201);
  const receipts = (await retry.json()).files;
  assert.equal(receipts.length, 2);
  assert.equal(objects.size, 3);
  for (const [index, file] of files.entries()) {
    const stored = objects.get(receipts[index].path);
    const expected = await sharp(Buffer.from(await file.arrayBuffer())).webp({quality:80,effort:3}).toBuffer();
    assert.deepEqual(stored,expected);
    assert.equal(receipts[index].mimeType,'image/webp');
    assert.match(receipts[index].path,/\.webp$/);
  }
});

test('a batch with broken pixels after a valid photo performs zero storage writes', async () => {
  const png = await sharp({create:{width:25,height:30,channels:3,background:'green'}}).png().toBuffer();
  const {send,calls} = fixture();
  const res = await send([png,png.subarray(0,38)].map(bytes=>new File([bytes],'photo.png',{type:'image/png'})));
  assert.equal(res.status,400);
  assert.deepEqual(calls,[]);
});

test('decoder unavailable and busy keep the whole group out of Storage', async () => {
  const png = await sharp({create:{width:2,height:3,channels:3,background:'red'}}).png().toBuffer();
  for(const [code,status] of [['MEDIA_UNAVAILABLE',503],['MEDIA_BUSY',429]]) {
    const {send,calls}=fixture(null,{},async()=>{throw new image.MediaImageError(code)});
    assert.equal((await send([new File([png],'photo.png',{type:'image/png'})])).status,status);
    assert.deepEqual(calls,[]);
  }
});
