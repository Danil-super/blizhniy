import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {once} from 'node:events';
import {existsSync,mkdtempSync,readFileSync,rmSync,symlinkSync,writeFileSync} from 'node:fs';
import {createConnection} from 'node:net';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {buildPublicationRestrictionOperator} from '../scripts/build-publication-restriction-operator.mjs';
import {startLocalPublicationRestrictionOperator} from '../scripts/local-publication-restriction-operator.mjs';

test('the publication restriction operator package pins reviewed migrations and validates its unit and socket',async t=>{
 const directory=mkdtempSync(join(tmpdir(),'blizhniy-publication-operator-'));
 t.after(()=>rmSync(directory,{recursive:true,force:true}));
 const output=join(directory,'operator');
 const manifest=buildPublicationRestrictionOperator(output);
 const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
 assert.equal(manifest.role,'blizhniy_publication_operator');
 assert.equal(manifest.dependencyLock,sha(readFileSync(join(output,'package-lock.json'))));
 assert.deepEqual(manifest.migrations.map(row=>row.name),['0093-publication-restrictions.sql','0094-publication-restriction-operator.sql','0095-restricted-response-delivery.sql']);
 for(const {name,sha256} of manifest.migrations)assert.equal(sha(readFileSync(join(output,'database/candidates',name))),sha256);
 assert.equal(sha(readFileSync(join(output,'database/publication-restriction-upgrade.sql'))),manifest.upgradeSha256);
 assert.equal(sha(readFileSync(join(output,'database/candidates/0096-publication-location-withdrawals.sql'))),manifest.locationWithdrawal.migrationSha256);
 assert.equal(sha(readFileSync(join(output,'scripts/publication-location-restore.mjs'))),manifest.locationWithdrawal.restoreToolSha256);
 assert.equal(existsSync(join(output,'src')),false);
 assert.throws(()=>buildPublicationRestrictionOperator(output));
 symlinkSync(fileURLToPath(new URL('../node_modules',import.meta.url)),join(output,'node_modules'),'dir');
 const load=name=>import(pathToFileURL(join(output,'scripts',name)));
 assert.equal(typeof (await load('local-publication-restriction-operator.mjs')).startLocalPublicationRestrictionOperator,'function');
 assert.equal(typeof (await load('publication-restriction-operator-role.mjs')).verifyPublicationRestrictionDatabase,'function');
 const command=join(output,'scripts/hosted-publication-restriction-operator.mjs');
 const rejected=spawnSync(process.execPath,[command,'--check'],{
  env:{PATH:process.env.PATH,NODE_ENV:'production',BLIZHNIY_PUBLICATION_RESTRICTION_OPERATOR:'hosted-v1',
   BLIZHNIY_DB_PASSWORD:'synthetic-never-logged'},encoding:'utf8',timeout:5000,
 });
 assert.equal(rejected.status,1);
 assert.equal(rejected.stdout,'');
 assert.deepEqual(JSON.parse(rejected.stderr),{event:'hosted_publication_restriction',status:'unavailable'});
 const base='blizhniy-publication-restriction';
 const socket=readFileSync(join(output,'ops',base+'.socket'),'utf8');
 const service=readFileSync(join(output,'ops',base+'.service'),'utf8');
 for(const value of ['ListenStream=/run/blizhniy-publication-restriction/operator.sock','SocketUser=root','SocketGroup=blizhniy-web',
  'SocketMode=0660','FileDescriptorName=operator','Accept=no'])assert.ok(socket.includes(value),value);
 for(const value of ['User=blizhniy-publication-operator','Group=blizhniy-publication-operator','NoNewPrivileges=yes',
  'ProtectSystem=strict','IPAddressAllow=127.0.0.1/32'])assert.ok(service.includes(value),value);
 const units=[join(directory,base+'.socket'),join(directory,base+'.service')];
 writeFileSync(units[0],socket);
 writeFileSync(units[1],service.replace('/opt/blizhniy-node22/bin/node',process.execPath));
 execFileSync('systemd-analyze',['verify','--man=no',...units],{timeout:5000,maxBuffer:16384});
});

test('shutdown drains a connection stalled before a complete HTTP header',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 const db={query:()=>assert.fail('Partial headers must never reach PostgreSQL'),close:async()=>{}};
 const server=await startLocalPublicationRestrictionOperator(db);
 const peer=createConnection(server.socketPath);
 let peerError;
 peer.on('error',error=>{peerError=error;});
 const disconnected=new Promise(resolve=>peer.once('close',resolve));
 let watchdog;
 try{
  await once(peer,'connect');
  await new Promise(resolve=>peer.write('POST /command HTTP/1.1\r\nHost: user-',resolve));
  await new Promise(setImmediate);
  const drained=server.close().then(()=>true);
  t.mock.timers.tick(16000);
  const stalled=new Promise(resolve=>{watchdog=setInterval(()=>resolve(false),3000);});
  assert.equal(await Promise.race([drained,stalled]),true);
 }finally{
  clearInterval(watchdog);
  peer.destroy();
  await disconnected;
  await server.close();
 }
 assert.ok(!peerError||peerError.code==='ECONNRESET');
});
