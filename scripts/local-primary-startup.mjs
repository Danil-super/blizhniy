import {randomUUID} from 'node:crypto';

const stages=new Set(['fixture','build','configuration','services','refunds','user-access','proxy','application','expiry']);
/** Fixed fields only: startup errors and acquired handles can contain credentials. */
export function createLocalStartupStep(write=event=>console.error(JSON.stringify(event))){
 const runId=randomUUID();
 return async(stage,operation)=>{
  if(!stages.has(stage)||typeof operation!=='function')throw Error('Invalid local startup step');
  const started=performance.now();
  const emit=status=>{
   try{write({event:'local_startup_step',entryPoint:'local-primary',runId,pid:process.pid,stage,status,elapsedMs:Math.round(performance.now()-started)});}
   catch{return false;} // Logging must not interrupt ownership transfer or cleanup.
  };
  emit('started');
  try{const result=await operation();emit('completed');return result;}
  catch(error){emit('failed');throw error;}
 };
}
