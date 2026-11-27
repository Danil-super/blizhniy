import {createHostedRefundWorkerRuntime} from './local-refund-worker-runtime.mjs';
import {runRefundWorkerService} from './refund-worker-service.mjs';

async function main(args){
 const [major,minor]=process.versions.node.split('.').map(Number);
 const supported=process.platform==='linux'&&major===22&&minor>=18&&process.getuid?.()!==0;
 const mode=args.length===1&&['--check','--run'].includes(args[0])?args[0].slice(2):'invalid';
 const controller=new AbortController(),stop=()=>controller.abort();
 let outputFailed=false;
 const outputError=()=>{outputFailed=true;stop();};
 process.on('SIGTERM',stop);process.on('SIGINT',stop);process.stdout.on('error',outputError);
 try{
  const code=await runRefundWorkerService({mode,signal:controller.signal,
   createRuntime:()=>{if(!supported)throw Error('Unsupported refund worker runtime');return createHostedRefundWorkerRuntime(process.env);},
   report:event=>new Promise((resolve,reject)=>process.stdout.write(JSON.stringify(event)+'\n',error=>error?reject(error):resolve())),
  });
  return outputFailed?1:code;
 }finally{
  process.off('SIGTERM',stop);process.off('SIGINT',stop);process.stdout.off('error',outputError);
 }
}

if(import.meta.main)process.exitCode=await main(process.argv.slice(2));
