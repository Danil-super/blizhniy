import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import {mkdtempSync,readFileSync,rmSync,symlinkSync,writeFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {buildAdminPasskeyOperator} from '../scripts/build-admin-passkey-operator.mjs';

test('the packaged passkey verifier imports its compiled dependencies and refuses unsupervised startup',async t=>{
 const directory=mkdtempSync(join(tmpdir(),'blizhniy-passkey-package-'));
 t.after(()=>rmSync(directory,{recursive:true,force:true}));
 const output=join(directory,'operator');
 const manifest=buildAdminPasskeyOperator(output);
 assert.equal(manifest.role,'blizhniy_passkey_verifier');
 assert.match(manifest.dependencyLock,/^[0-9a-f]{64}$/);
 assert.equal(manifest.migrations.length,6);
 symlinkSync(fileURLToPath(new URL('../node_modules',import.meta.url)),join(output,'node_modules'),'dir');
 const load=name=>import(pathToFileURL(join(output,'scripts',name)));
 assert.equal(typeof (await load('admin-passkey-operator.mjs')).startAdminPasskeyOperator,'function');
 const require=createRequire(join(output,'package.json'));
 assert.equal(typeof require('./compiled/lib/postgres-admin-passkey.js').AdminPasskeyStore,'function');
 assert.equal(typeof require('./compiled/lib/postgres-admin-passkey-enrollment.js').AdminPasskeyEnrollment,'function');
 assert.equal(typeof require('./compiled/lib/admin-archive-passkey.js').createAdminArchivePasskey,'function');
 assert.equal(typeof require('./compiled/lib/admin-refund-passkey.js').createAdminRefundPasskey,'function');
 await load('hosted-admin-passkey.mjs');
 const child=spawnSync(process.execPath,[join(output,'scripts/hosted-admin-passkey.mjs')],{
  env:{PATH:process.env.PATH,NODE_ENV:'production',BLIZHNIY_ADMIN_PASSKEYS:'hosted-v1'},
  encoding:'utf8',timeout:5000,
 });
 assert.equal(child.status,1);
 assert.equal(child.stdout,'');
 assert.deepEqual(JSON.parse(child.stderr),{event:'hosted_admin_passkey',status:'unavailable'});
 const issuer=join(output,'scripts/issue-admin-passkey.mjs');
 const api=await load('issue-admin-passkey.mjs');
 assert.equal(typeof api.issueReviewedAdminPasskeyCode,'function');
 const redirected=spawnSync(process.execPath,[issuer,'--add'],{
  env:{PATH:process.env.PATH,NODE_ENV:'production'},input:'fixture\n',encoding:'utf8',timeout:5000,
 });
 assert.equal(redirected.status,1);
 assert.equal(redirected.stdout,'');
 assert.match(redirected.stderr,/interactive terminal/i);
 const socket=join(output,'ops/blizhniy-admin-passkey.socket');
 const service=join(output,'ops/blizhniy-admin-passkey.service');
 for(const entry of ['ListenStream=/run/blizhniy-admin-passkey/operator.sock','SocketUser=root','SocketGroup=blizhniy-web',
  'SocketMode=0660','FileDescriptorName=operator','Accept=no'])assert.ok(readFileSync(socket,'utf8').includes(entry),entry);
 const serviceSource=readFileSync(service,'utf8');
 for(const entry of ['User=blizhniy-passkey-verifier','Group=blizhniy-passkey-verifier','ProtectSystem=strict','NoNewPrivileges=true'])
  assert.ok(serviceSource.includes(entry),entry);
 const localService=join(directory,'blizhniy-admin-passkey.service');
 const localSocket=join(directory,'blizhniy-admin-passkey.socket');
 writeFileSync(localSocket,readFileSync(socket));
 writeFileSync(localService,serviceSource.replace('/opt/blizhniy-node22/bin/node',process.execPath));
 execFileSync('systemd-analyze',['verify','--man=no',localSocket,localService],{timeout:5000,maxBuffer:16384});
});
