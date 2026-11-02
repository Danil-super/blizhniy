// Owned loopback acceptance. Never switches a real PM2 process or a release link.
import assert from 'node:assert/strict';
import {spawn,execFile} from 'node:child_process';
import {once} from 'node:events';
import {promisify} from 'node:util';
import {createServer} from 'node:net';
import {readFile,mkdir,mkdtemp,writeFile,open,realpath} from 'node:fs/promises';
import {join} from 'node:path';
import {homedir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {stateFile,docker} from './local-primary-fixture.mjs';
import {readLocalPrimaryState,validateLocalPrimaryContainer} from './local-primary-config.mjs';
import {boundedHandoffRequest} from './handoff-http.mjs';
import {readRollbackBuildId,verifyRollbackReadiness} from './check-rollback-readiness.mjs';

const root=await realpath(fileURLToPath(new URL('..',import.meta.url)));
const cache=join(homedir(),'.cache','blizhniy-audit-f18');await mkdir(cache,{mode:0o700,recursive:true});
const directory=await mkdtemp(join(cache,'actual-')),release=join(directory,'release');
const state=readLocalPrimaryState(stateFile,root);validateLocalPrimaryContainer(JSON.parse(await docker(['inspect',state.containerId]))[0],state);
const buildId=(await readFile(join(root,'.next/BUILD_ID'),'utf8')).trim();
await mkdir(join(release,'.next'),{mode:0o700,recursive:true});await writeFile(join(release,'.next/BUILD_ID'),buildId,{mode:0o600,flag:'wx'});
assert.equal(readRollbackBuildId(release),buildId);
const {stdout}=await promisify(execFile)(process.execPath,[join(root,'scripts/check-rollback-readiness.mjs'),'--build-id',release],{env:{PATH:process.env.PATH},timeout:5000,maxBuffer:4096});assert.equal(stdout,buildId+'\n');
assert.deepEqual(await verifyRollbackReadiness({port:state.upstreamPort,buildId}),{ready:true},'real primary DB readiness, HTML and manifest pass');
assert.deepEqual(await verifyRollbackReadiness({port:state.upstreamPort,buildId:'wrong-build',deadlineMs:600}),{ready:false},'wrong running build refuses rollback completion');
const reservation=createServer();reservation.listen(0,'127.0.0.1');await once(reservation,'listening');const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
const log=await open(join(directory,'unconfigured-next.log'),'wx',0o600);
// __NEXT_PROCESSED_ENV prevents dotenv. No DB/mail/provider credentials exist in
// this process; postgres mode is deliberately incomplete, so ready must fail.
const child=spawn(process.execPath,[join(root,'node_modules/next/dist/bin/next'),'start','--hostname','127.0.0.1','--port',String(port)],{
 cwd:root,env:{PATH:process.env.PATH,LANG:'C.UTF-8',NODE_ENV:'production',__NEXT_PROCESSED_ENV:'true',NEXT_TELEMETRY_DISABLED:'1',BLIZHNIY_AUTH_MODE:'postgres'},stdio:['ignore',log.fd,log.fd]});
const spawned=once(child,'spawn'),exited=once(child,'exit');spawned.catch(()=>{});exited.catch(()=>{});await log.close();
const alive=()=>child.exitCode===null&&child.signalCode===null;
try{
 await spawned;
 for(const end=performance.now()+15000;;){
  assert.ok(alive(),'owned Next stays alive');
  let healthy=false;try{healthy=(await boundedHandoffRequest({hostname:'127.0.0.1',port,path:'/api/health'},{deadlineMs:500})).status===200;}catch{ /* Only bounded read-only startup polling. */ }
  if(healthy)break;assert.ok(performance.now()<end,'owned Next startup deadline');await new Promise(resolve=>setTimeout(resolve,100));
 }
 assert.equal((await boundedHandoffRequest({hostname:'127.0.0.1',port,path:'/api/ready'})).status,503,'real Next health200 is insufficient with missing DB configuration');
 assert.deepEqual(await verifyRollbackReadiness({port,buildId,deadlineMs:600}),{ready:false});
 console.log('Local rollback readiness passed: real primary SQL/HTML/build, wrong-build refusal, separate actual Next health200/ready503 rejected; no PM2, production or DB writes.');
}finally{
 if(alive()){child.kill('SIGTERM');await Promise.race([exited,new Promise(resolve=>setTimeout(resolve,5000))]);if(alive()){child.kill('SIGKILL');await exited;}}
}
