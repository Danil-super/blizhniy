import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';

const states=new Set(['idle','lost','completed','deferred','blocked']);
const codes=new Set(['provider_pending','provider_canceled','source_unavailable','processing_unavailable','attempts_exhausted']);
const pause=(ms,signal)=>delay(ms,undefined,{signal});

/** Explicit private orchestration only. Never adopts HTTP credentials or starts on import.
 * Unknown SQL/COMMIT errors stop the loop; the durable queues own financial recovery.
 */
export async function runRefundWorkerService({mode,createRuntime,signal,report,wait=pause}={}){
 const runId=randomUUID(),started=performance.now(),outcomes={};
 let runtime,stage='configuration',failureStage,telemetryFailed=false;
 const emit=async fields=>{
  try{await report({event:'refund_worker_service',runId,mode:['check','run'].includes(mode)?mode:'invalid',
   durationMs:Math.round(performance.now()-started),...fields});}
  catch{telemetryFailed=true;throw Error('Refund telemetry unavailable');}
 };
 try{
  if(!['check','run'].includes(mode)||typeof createRuntime!=='function'||typeof report!=='function'||typeof wait!=='function'||!(signal instanceof AbortSignal))throw Error();
  if(!signal.aborted){
   runtime=await createRuntime();
   if(typeof runtime?.preflight!=='function'||typeof runtime?.placement?.tick!=='function'||typeof runtime?.application?.sweep!=='function'||typeof runtime?.close!=='function')throw Error();
   stage='preflight';
   if(!signal.aborted)await runtime.preflight();
   if(mode==='run'&&!signal.aborted){
    await emit({status:'ready'});
    let kind='placement';
    while(!signal.aborted){
     stage='delivery';const tickStarted=performance.now();
     const result=kind==='placement'?await runtime.placement.tick():(await runtime.application.sweep())?.processing;
     if(!states.has(result?.state)||(['deferred','blocked'].includes(result.state)?!codes.has(result.code):result.code!==undefined))throw Error();
     const key=kind+':'+result.state;outcomes[key]=(outcomes[key]??0)+1;
     await emit({status:'tick',kind,state:result.state,...(result.code?{code:result.code}:{}),tickDurationMs:Math.round(performance.now()-tickStarted)});
     // Existing consumers collapse processor/COMMIT uncertainty into this code.
     if(result.code==='processing_unavailable')throw Error();
     kind=kind==='placement'?'application':'placement';
     if(signal.aborted)break;
     stage='wait';
     try{await wait(result.state==='idle'?5000:250,signal);}
     catch(error){if(!(signal.aborted&&error?.name==='AbortError'))throw error;}
    }
   }
  }
 }catch{failureStage=telemetryFailed?'telemetry':stage;}
 finally{try{await runtime?.close();}catch{failureStage??='shutdown';}}
 if(!telemetryFailed){try{await emit({status:failureStage?'unavailable':signal?.aborted?'stopped':'checked',...(failureStage?{failureStage}:{}),outcomes});}catch{failureStage??='telemetry';}}
 return failureStage?1:0;
}
