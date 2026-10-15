import assert from 'node:assert/strict';
import {createServer} from 'node:net';
import {spawn,execFileSync} from 'node:child_process';
import {once} from 'node:events';
import {mkdtemp,rm,writeFile,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import sharp from 'sharp';
import {createMediaSocketClient} from '../src/lib/media-socket.ts';

test('an actual accepted socket survives request EOF and a separate decoder returns validated pixels through fd1',async t=>{
 const root=await mkdtemp(join(tmpdir(),'blizhniy-stdio-')),path=join(root,'socket');let child;
 const sockets=new Set();
 const server=createServer({allowHalfOpen:true},socket=>{
  sockets.add(socket);socket.on('error',()=>{});socket.on('close',()=>sockets.delete(socket));
  child=spawn(process.execPath,['--experimental-strip-types','--no-warnings','tests/media-socket-stdio-fixture.mjs'],
   {env:{NODE_ENV:'test'},stdio:[socket,socket,'ignore']});
  child.once('close',()=>socket.destroy());
 });
 server.listen(path);await once(server,'listening');
 t.after(async()=>{child?.kill('SIGKILL');for(const socket of sockets)socket.destroy();await new Promise(resolve=>server.close(resolve));await rm(root,{recursive:true});});
 const source=await sharp({create:{width:80,height:40,channels:3,background:'red'}}).withMetadata({orientation:6}).jpeg().toBuffer();
 const image=await createMediaSocketClient(path,()=>{}).normalize(source,'image/jpeg');
 assert.equal(image.width,40);assert.equal(image.height,80);
 const metadata=await sharp(image.bytes).metadata();assert.equal(metadata.format,'webp');assert.equal(metadata.exif,undefined);assert.equal(metadata.icc,undefined);
});
test('production socket and service template enforce one connection, dedicated decoder and bounded isolated lifetime',async()=>{
 const socket=await readFile('ops/systemd/blizhniy-media.socket','utf8'),service=await readFile('ops/systemd/blizhniy-media@.service','utf8');
 for(const text of ['Accept=yes','MaxConnections=1','MaxConnectionsPerSource=1','SocketMode=0600','SocketUser=blizhniy-web','DirectoryMode=0755'])assert.ok(socket.includes(text),text);
 for(const text of ['User=blizhniy-media','Type=exec','StandardInput=socket','StandardOutput=socket','MemoryMax=512M','RuntimeMaxSec=8','TimeoutStopSec=1',
  'KillMode=control-group','PrivateNetwork=true','RestrictNamespaces=true','NoNewPrivileges=true','ProtectSystem=strict','ProtectHome=true','CapabilityBoundingSet=',
  'InaccessiblePaths=-/etc/blizhniy -/var/lib/blizhniy-web -/etc/blizhniy-media-runtime.json'])assert.ok(service.includes(text),text);
 assert.doesNotMatch(service,/EnvironmentFile|NODE_ENV=test|Restart=/);
 const root=await mkdtemp(join(tmpdir(),'blizhniy-socket-units-'));
 try{
  await writeFile(join(root,'blizhniy-media.socket'),socket);
  await writeFile(join(root,'blizhniy-media@.service'),service.replace('/opt/blizhniy-node22/bin/node',process.execPath));
  execFileSync('systemd-analyze',['verify','--man=no',join(root,'blizhniy-media.socket'),join(root,'blizhniy-media@.service')],{timeout:5000,maxBuffer:16384});
 }finally{await rm(root,{recursive:true});}
});
