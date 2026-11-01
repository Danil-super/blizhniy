import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createServer} from 'node:http';
import {chmod,link,mkdir,mkdtemp,rm,symlink,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {readRollbackBuildId,verifyRollbackReadiness} from '../scripts/check-rollback-readiness.mjs';

const run = promisify(execFile),buildId = 'synthetic-rollback-build';
const helper = fileURLToPath(new URL('../scripts/check-rollback-readiness.mjs',import.meta.url));
const paths = ['/api/health','/api/ready','/',`/_next/static/${buildId}/_buildManifest.js`];
const html = id => '<meta name="blizhniy-auth-backend" content="postgres"><script>self.__next_f.push(' +
  JSON.stringify([1,`0:${JSON.stringify({b:id})}\n`]) + ')</script>';
const bodies = ['{"ok":true}','{"ok":true,"service":"blizhniy"}',html(buildId),'self.__BUILD_MANIFEST={};'];
async function release(t,body = `${buildId}\n`) {
  const path = await mkdtemp(join(tmpdir(),'rollback-probe-'));
  t.after(() => rm(path,{recursive:true,force:true}));
  await mkdir(join(path,'.next'),{mode:0o755});
  const file = join(path,'.next','BUILD_ID');await writeFile(file,body,{mode:0o644});
  return {path,file};
}
async function web(t,handler) {
  const requests = [],timers = new Set();
  const server = createServer((req,res) => {
    requests.push({method:req.method,path:req.url});
    const send = (stage = paths.indexOf(req.url),replace = {}) => {
      res.writeHead(replace.status ?? 200,{'content-type':stage === 2 ? 'text/html' : stage === 3 ? 'application/javascript' : 'application/json',...replace.headers});
      res.end(replace.body ?? bodies[stage]);
    };
    const later = (fn,ms) => {const timer = setTimeout(() => {timers.delete(timer);fn();},ms);timers.add(timer);};
    handler(req,res,send,later);
  });
  await new Promise((resolve,reject) => {server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  t.after(() => new Promise(resolve => {
    for (const timer of timers) clearTimeout(timer);
    server.closeAllConnections();server.close(resolve);
  }));
  return {port:server.address().port,requests};
}
const check = (f,deadlineMs = 100) => verifyRollbackReadiness({port:f.port,buildId,deadlineMs});
const readOnly = f => assert.ok(f.requests.every(req => req.method === 'GET' && paths.includes(req.path)));

test('rollback build metadata accepts one safe line with optional final LF',async t => {
  for (const body of [buildId,`${buildId}\n`,'x'.repeat(128)+'\n']) {
    const f = await release(t,body);assert.equal(await readRollbackBuildId(f.path),body.trimEnd());
  }
});
test('rollback metadata rejects missing, nonregular, linked and writable BUILD_ID',async t => {
  for (const kind of ['missing','directory','symlink','hardlink','group-write','world-write']) {
    const f = await release(t);await rm(f.file);
    if (kind === 'directory') await mkdir(f.file);
    else if (kind === 'symlink' || kind === 'hardlink') {
      const target = join(f.path,'target');await writeFile(target,buildId);
      await (kind === 'symlink' ? symlink : link)(target,f.file);
    } else if (kind !== 'missing') {
      await writeFile(f.file,buildId);await chmod(f.file,kind === 'group-write' ? 0o664 : 0o646);
    }
    await assert.rejects(async () => readRollbackBuildId(f.path));
  }
});
test('rollback metadata rejects symlinked release or build directory and noncanonical roots',async t => {
  const f = await release(t),alias = `${f.path}-alias`;
  await symlink(f.path,alias);t.after(() => rm(alias,{force:true}));
  await assert.rejects(async () => readRollbackBuildId(alias));
  await assert.rejects(async () => readRollbackBuildId(`${f.path}/.next/..`));
  await rm(join(f.path,'.next'),{recursive:true});await mkdir(join(f.path,'linked-next'));
  await writeFile(join(f.path,'linked-next','BUILD_ID'),buildId);
  await symlink(join(f.path,'linked-next'),join(f.path,'.next'));
  await assert.rejects(async () => readRollbackBuildId(f.path));
});
test('rollback metadata rejects malformed, oversized and malicious IDs without disclosure',async t => {
  for (const body of ['',`${buildId}\n\n`,`${buildId}\r\n`,'../synthetic-private-marker','a/b','x'.repeat(130),'valid\nother']) {
    const f = await release(t,body);
    await assert.rejects(async () => readRollbackBuildId(f.path),error => {
      assert.ok(!String(error).includes(f.path));assert.ok(!String(error).includes('synthetic-private-marker'));return true;
    });
  }
});
test('rollback probe accepts only complete readiness for the expected HTML build and assets',async t => {
  const f = await web(t,(_req,_res,send) => send());
  assert.deepEqual(await check(f,700),{ready:true});assert.deepEqual(f.requests,paths.map(path => ({method:'GET',path})));
});
test('rollback probe refuses unhealthy readiness, wrong HTML build, broken manifest and redirects',async t => {
  for (const [stage,replace] of [[1,{body:'{"ok":false,"service":"blizhniy"}'}],[1,{body:'{'}],
    [2,{body:html('other-build')}],[3,{body:'unavailable'}],[0,{status:302,headers:{location:'/private-fixture'},body:'synthetic-private-marker'}]]) {
    const f = await web(t,(req,_res,send) => send(undefined,req.url === paths[stage] ? replace : {}));
    assert.deepEqual(await check(f),{ready:false});readOnly(f);
  }
});
test('rollback probe shares one deadline across stages and startup retries',async t => {
  const f = await web(t,(_req,_res,send,later) => later(() => send(),65)),start = performance.now();
  assert.deepEqual(await check(f,110),{ready:false});
  assert.ok(performance.now()-start < 800);assert.deepEqual(f.requests,paths.slice(0,2).map(path => ({method:'GET',path})));
  const silent = await web(t,() => {}),silentStart = performance.now();
  assert.deepEqual(await check(silent),{ready:false});assert.ok(performance.now()-silentStart < 800);readOnly(silent);
});
test('rollback probe can recover read-only readiness during bounded startup',async t => {
  let attempts = 0;
  const f = await web(t,(req,_res,send) => send(undefined,req.url === paths[1] && ++attempts === 1 ? {body:'{"ok":false}'} : {}));
  assert.deepEqual(await check(f,700),{ready:true});assert.ok(attempts >= 2);readOnly(f);
});
test('rollback probe validates port, build and public deadline before I/O',async () => {
  for (const change of [{port:80},{port:'3000'},{buildId:'../unsafe'},{deadlineMs:99},{deadlineMs:45001}]) {
    await assert.rejects(async () => verifyRollbackReadiness({port:3000,buildId,deadlineMs:100,...change}));
  }
});
test('rollback CLI prints only a validated build ID and uses the same actual HTTP proof',async t => {
  const f = await release(t),result = await run(process.execPath,[helper,'--build-id',f.path]);
  assert.equal(result.stdout,`${buildId}\n`);assert.equal(result.stderr,'');
  const server = await web(t,(_req,_res,send) => send());
  const probe = await run(process.execPath,[helper,'--probe',String(server.port),buildId],{timeout:3000});
  assert.equal(probe.stderr,'');readOnly(server);
  await writeFile(f.file,'../synthetic-private-marker');
  await assert.rejects(() => run(process.execPath,[helper,'--build-id',f.path]),error => {
    const output = error.stdout + error.stderr;
    assert.ok(!output.includes(f.path));assert.ok(!output.includes('synthetic-private-marker'));return true;
  });
});
