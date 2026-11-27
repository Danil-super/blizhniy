import {constants} from 'node:fs';
import {access} from 'node:fs/promises';
import {createHostedRefundOperatorRuntime} from './local-refund-operator-runtime.mjs';
import {startLocalRefundOperatorServer} from './local-refund-operator-server.mjs';
import {readActivatedOperatorSocket} from './hosted-operator-socket.mjs';

const status=value=>JSON.stringify({event:'hosted_refund_operator',status:value});

async function main(args,env){
 const check=args.length===1&&args[0]==='--check';
 const [major,minor]=process.versions.node.split('.').map(Number);
 if((args.length&&!check)||process.platform!=='linux'||major!==22||minor<18||process.getuid?.()===0)throw Error();
 const guarded=env.BLIZHNIY_REFUND_OPERATOR==='hosted-passkey-test-v1';
 const socketPath=guarded?
  '/run/blizhniy-refund-operator-passkey/operator.sock':'/run/blizhniy-refund-operator/operator.sock';
 const activation=check?undefined:await readActivatedOperatorSocket(env,socketPath);
 if(guarded)await access('/run/blizhniy-admin-passkey/operator.sock',constants.W_OK);
 const runtime=await createHostedRefundOperatorRuntime(env);
 let server;
 const stop=()=>{void server?.close().catch(()=>{process.exitCode=1;});};
 try{
  if(check){await runtime.preflight();console.log(status('checked'));return;}
  server=await startLocalRefundOperatorServer(runtime,{activation});
  process.once('SIGTERM',stop);process.once('SIGINT',stop);
  console.log(status('ready'));
  if(await server.done!==0)throw Error();
 }finally{
  process.removeListener('SIGTERM',stop);process.removeListener('SIGINT',stop);
  if(server)await server.close();else await runtime.close();
 }
}

if(import.meta.main){
 try{await main(process.argv.slice(2),process.env);}
 catch{console.error(status('unavailable'));process.exitCode=1;}
}
