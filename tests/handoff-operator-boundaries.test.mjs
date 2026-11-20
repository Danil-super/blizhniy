import assert from 'node:assert/strict';
import {test} from 'node:test';
import {chmod,link,mkdtemp,readFile,rename,rm,stat,symlink,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:http';
import {openHandoffJournal} from '../scripts/handoff-journal.mjs';
import {createCaddyWebRoute} from '../scripts/caddy-web-route.mjs';

const operationId = '00000000-0000-4000-8000-000000000001';
const otherId = '00000000-0000-4000-8000-000000000002';
const event = () => ({operationId,action:'switch',phase:'intent',previousPort:3000,nextPort:3001});
async function directory(t) {
  const path = await mkdtemp(join(tmpdir(),'handoff-boundary-'));
  await chmod(path,0o700);t.after(() => rm(path,{recursive:true,force:true}));return path;
}
async function caddy(t,handler) {
  const path = await directory(t),socketPath = join(path,'admin.sock'),requests = [];
  const server = createServer(async (req,res) => {
    let body = '';for await (const chunk of req) body += chunk;
    requests.push({method:req.method,url:req.url,headers:req.headers,body});
    handler(req,res,body);
  });
  await new Promise((resolve,reject) => {server.once('error',reject);server.listen(socketPath,resolve);});
  await chmod(socketPath,0o600);
  t.after(() => new Promise(resolve => {server.closeAllConnections();server.close(resolve);}));
  return {socketPath,requests,route:createCaddyWebRoute({socketPath,ports:[3000,3001],deadlineMs:40})};
}
const send = (res,value,etag = '"revision-1"') => {
  res.writeHead(200,{'content-type':'application/json',...(etag ? {etag} : {})});res.end(JSON.stringify(value));
};

test('journal creates private durable records and releases only its completed operation',async t => {
  const path = await directory(t),journal = await openHandoffJournal(path,operationId);
  t.after(() => journal.close());
  assert.equal(await journal.record(event()),true);
  for (const name of ['.handoff.lock',`${operationId}.jsonl`]) {
    const info = await stat(join(path,name));assert.equal(info.mode & 0o777,0o600);assert.equal(info.nlink,1);
  }
  const records = (await readFile(join(path,`${operationId}.jsonl`),'utf8')).trim().split('\n').map(JSON.parse);
  assert.equal(records.length,1);const {at,...stored} = records[0];assert.ok(Number.isSafeInteger(at));assert.deepEqual(stored,event());
  await assert.rejects(async () => openHandoffJournal(path,otherId));
  assert.equal(await journal.finish({operationId,state:'complete'}),false);
  assert.equal(await journal.record({operationId,action:'result',phase:'observed',state:'complete'}),true);
  assert.equal(await journal.finish({operationId,state:'complete'}),true);
  await assert.rejects(() => stat(join(path,'.handoff.lock')), {code:'ENOENT'});
});
test('unknown journal lock is preserved byte-for-byte without stale cleanup',async t => {
  const path = await directory(t),lock = join(path,'.handoff.lock');
  await writeFile(lock,'unknown-owner\n',{mode:0o600});
  await assert.rejects(async () => openHandoffJournal(path,operationId));assert.equal(await readFile(lock,'utf8'),'unknown-owner\n');
});
test('unsafe result, foreign operation and close retain the lock against reentry',async t => {
  for (const result of [{operationId,state:'recovery-required'},{operationId,state:'complete-old-retained'},{operationId:otherId,state:'complete'}]) {
    const path = await directory(t),journal = await openHandoffJournal(path,operationId);
    assert.equal(await journal.finish(result),false);await journal.close();
    await assert.rejects(async () => openHandoffJournal(path,otherId));assert.ok(await stat(join(path,'.handoff.lock')));
  }
});
test('journal rejects symlink directories, public directories and preexisting linked record files',async t => {
  const path = await directory(t),alias = `${path}-link`;await symlink(path,alias);t.after(() => rm(alias,{force:true}));
  await assert.rejects(async () => openHandoffJournal(alias,operationId));
  await chmod(path,0o755);await assert.rejects(async () => openHandoffJournal(path,operationId));await chmod(path,0o700);
  for (const make of [symlink,link]) {
    const linkedPath = await directory(t),sentinel = join(linkedPath,'sentinel');
    await writeFile(sentinel,'preserve',{mode:0o600});await make(sentinel,join(linkedPath,`${operationId}.jsonl`));
    await assert.rejects(async () => openHandoffJournal(linkedPath,operationId));assert.equal(await readFile(sentinel,'utf8'),'preserve');
  }
});
test('journal rejects secret-bearing or foreign records and bounds accepted records',async t => {
  const path = await directory(t),journal = await openHandoffJournal(path,operationId);t.after(() => journal.close());
  for (const invalid of [{...event(),operationId:otherId},{...event(),error:'private-token-value'},
    {...event(),action:'delete'},{...event(),phase:'unknown'}]) await assert.rejects(() => journal.record(invalid));
  for (let i = 0;i < 64;i++) assert.equal(await journal.record(event()),true);
  await assert.rejects(() => journal.record(event()));
  const contents = await readFile(join(path,`${operationId}.jsonl`),'utf8');
  assert.equal(contents.trim().split('\n').length,64);assert.ok(!contents.includes('private-token-value'));
});
test('journal rejects accessor records before validation can differ from persisted data',async t => {
  const path = await directory(t),journal = await openHandoffJournal(path,operationId);t.after(() => journal.close());
  let reads = 0;const unsafe = {...event(),get action(){return ++reads === 1 ? 'switch' : 'private-token-value';}};
  await assert.rejects(() => journal.record(unsafe));
  assert.equal(await readFile(join(path,`${operationId}.jsonl`),'utf8'),'');
});
test('journal refuses changed directory permissions or replaced journal pathname before writing',async t => {
  for (const change of ['permissions','pathname']) {
    const path = await directory(t),journal = await openHandoffJournal(path,operationId);t.after(() => journal.close());
    const file = join(path,`${operationId}.jsonl`);
    if (change === 'permissions') await chmod(path,0o755);
    else {await rename(file,`${file}.saved`);await writeFile(file,'replacement',{mode:0o600});}
    await assert.rejects(() => journal.record(event()));
    assert.ok(await stat(join(path,'.handoff.lock')));
    assert.equal(await readFile(change === 'permissions' ? file : `${file}.saved`,'utf8'),'');
  }
});

test('Caddy switch uses one fixed upstream path, exact If-Match and verifies the observed target',async t => {
  let port = 3000,revision = 1;
  const f = await caddy(t,(req,res,body) => {
    if (req.method === 'PATCH') {port = Number(JSON.parse(body)[0].dial.split(':')[1]);revision++;res.writeHead(200);res.end();}
    else send(res,[{dial:`127.0.0.1:${port}`}],`"revision-${revision}"`);
  });
  const expected = await f.route.read();assert.deepEqual(expected,{port:3000,etag:'"revision-1"'});
  assert.deepEqual(await f.route.switch(expected,3001),{port:3001,etag:'"revision-2"'});
  const writes = f.requests.filter(r => r.method !== 'GET');assert.equal(writes.length,1);
  assert.equal(writes[0].method,'PATCH');assert.equal(writes[0].headers['if-match'],expected.etag);
  assert.deepEqual(JSON.parse(writes[0].body),[{dial:'127.0.0.1:3001'}]);
  assert.ok(f.requests.every(r => r.url === '/id/blizhniy-web/upstreams'));
});
test('Caddy read refuses multiple, expanded, foreign or unversioned upstream responses',async t => {
  for (const value of [[{dial:'127.0.0.1:3000'},{dial:'127.0.0.1:3001'}],[{dial:'localhost:3000'}],
    [{dial:'127.0.0.1:4444'}],[{dial:'127.0.0.1:3000',tls:true}],[{dial:'127.0.0.1:3000?secret=value'}],{dial:'127.0.0.1:3000'}]) {
    const f = await caddy(t,(_req,res) => send(res,value));await assert.rejects(() => f.route.read());
  }
  for (const etag of [null,'unquoted','W/"weak"']) {
    const f = await caddy(t,(_req,res) => send(res,[{dial:'127.0.0.1:3000'}],etag));await assert.rejects(() => f.route.read());
  }
});
test('Caddy CAS conflict and unknown write outcome never retry or follow redirects',async t => {
  for (const status of [412,500,302]) {
    const f = await caddy(t,(req,res) => {
      if (req.method === 'GET') send(res,[{dial:'127.0.0.1:3000'}]);
      else {res.writeHead(status,{location:'http://example.invalid/private-token-value'});res.end('private-token-value');}
    });
    await assert.rejects(() => f.route.switch({port:3000,etag:'"revision-1"'},3001),error => {
      if (status === 412) assert.equal(error.code,'HANDOFF_CONFLICT');
      assert.ok(!String(error).includes('private-token-value'));return true;
    });
    assert.equal(f.requests.filter(r => r.method === 'PATCH').length,1);
    assert.ok(f.requests.every(r => r.url === '/id/blizhniy-web/upstreams'));
  }
});
test('Caddy rejects an unobserved target after acknowledged switch and unsafe target before I/O',async t => {
  const f = await caddy(t,(req,res) => req.method === 'PATCH' ? res.end() : send(res,[{dial:'127.0.0.1:3000'}]));
  await assert.rejects(() => f.route.switch({port:3000,etag:'"revision-1"'},3001));
  const before = f.requests.length;
  await assert.rejects(() => f.route.switch({port:3000,etag:'"revision-1"'},4444));assert.equal(f.requests.length,before);
});
test('Caddy revalidates socket privacy on each request and bounds silent responses',async t => {
  const f = await caddy(t,() => {});await chmod(f.socketPath,0o666);
  await assert.rejects(() => f.route.read());assert.equal(f.requests.length,0);
  await chmod(f.socketPath,0o600);
  await assert.rejects(() => f.route.read(),error => {assert.ok(!String(error).includes(f.socketPath));return true;});
  assert.equal(f.requests.length,1);
});
test('Caddy refuses replaced, linked or disappeared sockets without exposing local paths',async t => {
  const f = await caddy(t,(_req,res) => send(res,[{dial:'127.0.0.1:3000'}]));
  assert.equal((await f.route.read()).port,3000);
  const original = `${f.socketPath}.saved`;await rename(f.socketPath,original);
  for (const make of [symlink,link]) {
    await make(original,f.socketPath);await assert.rejects(() => f.route.read());await rm(f.socketPath);
  }
  await assert.rejects(() => f.route.read(),error => {assert.ok(!String(error).includes(f.socketPath));return true;});
  assert.equal(f.requests.length,1);
});

test('Caddy accepts a single strong ETag trailer and uses it for the conditional switch',async t => {
  let port=3000;
  const f=await caddy(t,(req,res,body)=>{
    if(req.method==='PATCH'){
      assert.equal(req.headers['if-match'],'"port-3000"');
      port=Number(JSON.parse(body)[0].dial.split(':')[1]);
      res.writeHead(200);res.end();return;
    }
    res.writeHead(200,{'content-type':'application/json',trailer:'ETag'});
    res.write(JSON.stringify([{dial:'127.0.0.1:'+port}]));
    res.addTrailers({etag:'"port-'+port+'"'});res.end();
  });
  const previous=await f.route.read();
  assert.deepEqual(previous,{port:3000,etag:'"port-3000"'});
  assert.deepEqual(await f.route.switch(previous,3001),{port:3001,etag:'"port-3001"'});
});

test('Caddy rejects malformed or ambiguous ETags before sending a switch',async t => {
  for (const [header,trailer] of [
    [undefined,'W/"weak"'], ['"first"','"second"'], ['"same"','"same"'],
    [['"first"','"second"'],undefined], [undefined,['"first"','"second"']],
  ]) {
    const f=await caddy(t,(_req,res)=>{
      res.writeHead(200,{'content-type':'application/json',...(header?{etag:header}:{}),...(trailer?{trailer:'ETag'}:{})});
      res.write(JSON.stringify([{dial:'127.0.0.1:3000'}]));
      if(trailer)res.addTrailers({etag:trailer});
      res.end();
    });
    await assert.rejects(()=>f.route.read(),{code:'HANDOFF_READ'});
    assert.deepEqual(f.requests.map(request=>request.method),['GET']);
  }
});
