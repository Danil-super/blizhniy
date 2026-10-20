import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';

const codes=new Set(['provider_pending','capture_required','processing_unavailable','publication_blocked','attempts_exhausted']);
const states=new Set(['idle','lost','completed','deferred','blocked']);
const pause=(ms,signal)=>delay(ms,undefined,{signal});
const stdoutReport=event=>new Promise((resolve,reject)=>{
 process.stdout.write(JSON.stringify(event)+'\n',error=>error?reject(error):resolve());
});

/** Trusted caller supplies a private runtime: preflight(), worker.tick(), close().
 * No ambient DB/merchant configuration or automatic startup. Preflight must be read-only
 * and verify the exact schema/role/TEST scope before any claim; a failed factory owns cleanup.
 * A tick failure (including unknown COMMIT) stops this loop, never blindly retries it.
 */
export async function runPaymentReconciliationService({mode,createRuntime,signal,
 entryPoint='cli',report,wait=pause}={}) {
 const runId=randomUUID(),started=performance.now(),outcomes={};
 let runtime,stage='configuration',failureStage,telemetryFailed=false;
 const emit=async fields=>{
  try {
   await report({event:'payment_reconciliation_service',runId,
    entryPoint:['cli','service'].includes(entryPoint)?entryPoint:'invalid',
    mode:['check','run'].includes(mode)?mode:'invalid',
    durationMs:Math.round(performance.now()-started),...fields});
  } catch {telemetryFailed=true;throw new Error('Payment telemetry unavailable');}
 };
 try {
  if(!['check','run'].includes(mode)||!['cli','service'].includes(entryPoint)||
   typeof createRuntime!=='function'||typeof report!=='function'||typeof wait!=='function'||!(signal instanceof AbortSignal)) {
   throw new Error('Invalid service configuration');
  }
  if(!signal.aborted) {
   runtime=await createRuntime();
   if(typeof runtime?.preflight!=='function'||typeof runtime?.worker?.tick!=='function'||typeof runtime?.close!=='function') {
    throw new Error('Invalid service runtime');
   }
   stage='preflight';
   if(!signal.aborted)await runtime.preflight();
   if(mode==='run'&&!signal.aborted) {
    await emit({status:'ready'});
    while(!signal.aborted) {
     stage='delivery';
     const tickStarted=performance.now(),result=await runtime.worker.tick();
     if(!states.has(result?.state)||(['deferred','blocked'].includes(result.state)?!codes.has(result.code):result.code!==undefined)) {
      throw new Error('Invalid worker result');
     }
     outcomes[result.state]=(outcomes[result.state]??0)+1;
     await emit({status:'tick',state:result.state,...(result.code?{code:result.code}:{}),tickDurationMs:Math.round(performance.now()-tickStarted)});
     if(signal.aborted)break;
     stage='wait';
     try {await wait(result.state==='idle'?5000:250,signal);}
     catch(error) {if(!(signal.aborted&&error?.name==='AbortError'))throw error;}
    }
   }
  }
 } catch {failureStage=telemetryFailed?'telemetry':stage;}
 finally {
  try {await runtime?.close();}catch {failureStage??='shutdown';}
 }
 if(!telemetryFailed) {
  try {await emit({status:failureStage?'unavailable':signal?.aborted?'stopped':'checked',
   ...(failureStage?{failureStage}:{}),outcomes});}catch {failureStage??='telemetry';}
 }
 return failureStage?1:0;
}

/** Explicit process adapter. Importing this module installs no handlers and starts no work.
 * SIGTERM/SIGINT cancel admission and sleeps only: the current transactional tick drains.
 * The caller sets process.exitCode to the returned code, allowing stdout/pool cleanup.
 */
export async function runPaymentReconciliationProcess({createRuntime,mode,entryPoint='cli',report=stdoutReport}={}) {
 const controller=new AbortController(),stop=()=>controller.abort();
 let outputFailed=false;
 const outputError=()=>{outputFailed=true;stop();};
 process.on('SIGTERM',stop);process.on('SIGINT',stop);process.stdout.on('error',outputError);
 try {
  const code=await runPaymentReconciliationService({createRuntime,mode,entryPoint,report,signal:controller.signal});
  return outputFailed?1:code;
 } finally {
  process.off('SIGTERM',stop);process.off('SIGINT',stop);process.stdout.off('error',outputError);
 }
}
