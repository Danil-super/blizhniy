import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {realpathSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {createServer} from 'node:net';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {setTimeout as delay} from 'node:timers/promises';

const root=realpathSync(process.argv[2]),require=createRequire(root+'/server.js');
for(const name of ['pg','nodemailer','sharp'])assert.ok(require.resolve(name).startsWith(root+'/node_modules/'));
assert.equal(typeof require('pg').Pool,'function');
assert.equal(typeof require('nodemailer').createTransport,'function');
assert.equal(typeof (await import(pathToFileURL(root+'/scripts/auth-mail-worker-runtime.mjs'))).runAuthMailWorker,'function');
const image=await require('sharp')({create:{width:2,height:2,channels:3,background:'green'}}).webp().toBuffer();
assert.equal((await require('sharp')(image).metadata()).format,'webp');

const reservation=createServer();reservation.listen(0,'127.0.0.1');await once(reservation,'listening');
const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
const child=spawn(process.execPath,[root+'/server.js'],{cwd:root,stdio:'ignore',env:{PATH:process.env.PATH,LANG:'C.UTF-8',
 NODE_ENV:'production',HOSTNAME:'127.0.0.1',PORT:String(port),__NEXT_PROCESSED_ENV:'true',NEXT_TELEMETRY_DISABLED:'1'}});
let exited=false;const exit=new Promise(resolve=>{
 child.once('exit',()=>{exited=true;resolve();});child.once('error',()=>{exited=true;resolve();});
});
try{
 let healthy=false;
 for(let attempt=0;attempt<60&&!exited;attempt++){
  try{const response=await fetch(`http://127.0.0.1:${port}/api/health`,{signal:AbortSignal.timeout(1000)});
   if(response.status===200&&(await response.json()).ok===true){healthy=true;break;}}
  catch(error){if(!['TypeError','TimeoutError','AbortError'].includes(error.name))throw error;}
  await delay(250);
 }
 assert.ok(healthy,'Standalone health endpoint did not become ready');
 console.log('PASS prebuilt runtime: standalone health, generated WebP, PostgreSQL module and mail-worker imports; no SMTP or payment requests');
}finally{
 child.kill('SIGTERM');await Promise.race([exit,delay(3000)]);
 if(!exited){child.kill('SIGKILL');await exit;}
}
