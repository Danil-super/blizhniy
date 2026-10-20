// Owned child-process fixture: no environment loading, database or merchant access.
import {runPaymentReconciliationProcess} from '../scripts/payment-reconciliation-service.mjs';
const scenario=process.argv[2];
if(!['idle','drain','failure','broken-output'].includes(scenario))throw Error('Invalid process fixture');
const write=value=>process.stdout.write(JSON.stringify(value)+'\n');
let ticks=0;
process.exitCode=await runPaymentReconciliationProcess({mode:'run',entryPoint:'service',createRuntime:async()=>({
 preflight:async()=>{write({fixture:'preflight'});},
 worker:{tick:async()=>{
  ticks++;write({fixture:'tick',ticks});
  if(scenario==='failure')throw Error('synthetic-secret recipient@example.invalid');
  if(scenario==='drain')await new Promise(resolve=>{process.stdin.once('data',()=>{process.stdin.pause();resolve();});});
  if(scenario==='broken-output')process.stdout.destroy(new Error('synthetic-output-secret'));
  return{state:scenario==='idle'?'idle':'completed'};
 }},
 close:async()=>{if(scenario!=='broken-output')write({fixture:'close',ticks});},
})});
