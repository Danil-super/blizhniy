// Explicit command only. No dotenv, secret flags, auto-start on import or TS loader.
import {realpathSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {createPaymentWorkerRuntime} from './payment-worker-runtime.mjs';
import {runPaymentReconciliationProcess} from './payment-reconciliation-service.mjs';

export async function main(args=process.argv.slice(2),env=process.env){
 const [major,minor]=process.versions.node.split('.').map(Number);
 const supported=process.platform==='linux'&&major===22&&minor>=18&&process.getuid?.()!==0;
 const mode=args.length===1&&['--check','--run'].includes(args[0])?args[0].slice(2):'invalid';
 return runPaymentReconciliationProcess({mode,entryPoint:env.BLIZHNIY_PAYMENT_ENTRYPOINT??'cli',
  createRuntime:()=>{if(!supported)throw Error('Unsupported worker runtime');return createPaymentWorkerRuntime(env);}});
}

if(process.argv[1]&&realpathSync(process.argv[1])===realpathSync(fileURLToPath(import.meta.url)))process.exitCode=await main();
