import {runRefundWorkerService} from './refund-worker-service.mjs';

const unavailable=()=>Error('Local refund services unavailable');
/** Private lifecycle glue. Trusted factories keep their own target/role/TLS/TEST admission. */
export async function startLocalRefundServices({createOperator,createWorker,startOperatorServer,report,signal}={}){
 if([createOperator,createWorker,startOperatorServer,report].some(fn=>typeof fn!=='function')||!(signal instanceof AbortSignal)||signal.aborted)throw unavailable();
 const controller=new AbortController();
 let operator,server,serverClosing,closing,failed=false,ready=false,resolveReady,rejectReady;
 const startup=new Promise((resolve,reject)=>{resolveReady=resolve;rejectReady=reject;});
 const closeServer=()=>{
  if(server&&typeof server.close==='function')return serverClosing??=Promise.resolve().then(()=>server.close()).catch(()=>{failed=true;});
 };
 const stop=()=>{controller.abort();closeServer();};
 signal.addEventListener('abort',stop,{once:true});
 const done=(async()=>{
  try{
   operator=await createOperator();
   if(controller.signal.aborted||typeof operator?.preflight!=='function'||typeof operator?.close!=='function')throw unavailable();
   await operator.preflight();if(controller.signal.aborted)throw unavailable();
   const status=await runRefundWorkerService({mode:'run',createRuntime:createWorker,signal:controller.signal,report:async event=>{
    if(event.status==='ready'){
     if(controller.signal.aborted)throw unavailable();
     server=await startOperatorServer(operator);
     if(controller.signal.aborted||typeof server?.socketPath!=='string'||typeof server?.close!=='function')throw unavailable();
     await report(event);if(controller.signal.aborted)throw unavailable();
     ready=true;resolveReady();
    }else await report(event);
   }});
   if(status!==0)failed=true;
  }catch{failed=true;}
  finally{
   stop();
   await closeServer();
   if(!server||typeof server.close!=='function')try{await operator?.close?.();}catch{failed=true;}
   signal.removeEventListener('abort',stop);
   if(!ready)rejectReady(unavailable());
  }
  return failed?1:0;
 })();
 try{await startup;}catch{await done;throw unavailable();}
 return{socketPath:server.socketPath,done,close:()=>closing??=(async()=>{stop();if(await done!==0)throw unavailable();})()};
}
