// Trusted operator composition only, never an HTTP handler or import-time deploy.
const buildPattern=/^[A-Za-z0-9_-]{1,128}$/;
export function webSlot(value){
 if(!value||!['blue','green'].includes(value.slot)||!Number.isSafeInteger(value.port)||value.port<1024||value.port>65535||typeof value.buildId!=='string'||!buildPattern.test(value.buildId))throw new Error('Invalid web slot');
 return Object.freeze({slot:value.slot,port:value.port,buildId:value.buildId});
}
const snapshot=value=>value&&Number.isSafeInteger(value.port)&&typeof value.etag==='string'&&value.etag.length>0&&value.etag.length<=512&&!/[\r\n]/.test(value.etag)?Object.freeze({port:value.port,etag:value.etag}):null;
const same=(a,b)=>Boolean(a&&b&&a.port===b.port&&a.etag===b.etag);

/** The caller supplies a held exclusive lease + fsync journal and owns process handles.
 * A failed/unknown write is never retried. Recovery preserves the live processes. */
export function createWebHandoff(plan,adapters){
 const previous=webSlot(plan?.previous),next=webSlot(plan?.next),operationId=plan?.operationId;
 if(previous.slot===next.slot||previous.port===next.port||typeof operationId!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(operationId))throw new Error('Invalid handoff plan');
 for(const name of ['admission','start','probe','confirm','promote','drain'])if(typeof adapters?.[name]!=='function')throw new Error('Missing handoff adapter');
 if(typeof adapters?.route?.read!=='function'||typeof adapters?.route?.switch!=='function'||typeof adapters?.journal?.record!=='function')throw new Error('Missing handoff boundary');
 let attempted=false;
 const note=async(action,phase,slot,extra={})=>{
  if(await adapters.journal.record({operationId,previousBuildId:previous.buildId,nextBuildId:next.buildId,previousPort:previous.port,nextPort:next.port,action,phase,...(slot?{slot:slot.slot,port:slot.port}:{}),...extra})!==true)throw new Error('Journal not durable');
 };
 const ready=async slot=>{const result=await adapters.probe(slot);return result?.ready===true&&result.buildId===slot.buildId;};
 return {async run(){
  if(attempted)throw new Error('Handoff already attempted');attempted=true;
  let mutated=false,stage='admission';
  const finish=async state=>{await note('result','observed',null,{state});return {state,stage,operationId};};
  try{
   await note('check','intent');
   if(await adapters.admission(previous,next)!==true)return await finish('not-started');
   stage='previous-ready';if(!await ready(previous))return await finish('not-started');
   const initial=snapshot(await adapters.route.read());
   if(!initial||initial.port!==previous.port)return await finish('not-started');
   stage='start';await note('start','intent',next);mutated=true;
   const started=await adapters.start(next);
   if(started!==true)return await finish(started===false?'not-promoted':'recovery-required');
   await note('start','observed',next);
   stage='candidate-ready';
   if(!await ready(next)){
    if(!same(snapshot(await adapters.route.read()),initial))return await finish('recovery-required');
    await note('drain','intent',next);
    if(!same(snapshot(await adapters.route.read()),initial))return await finish('recovery-required');
    if(await adapters.drain(next)!==true)return await finish('recovery-required');
    await note('drain','observed',next);return await finish('not-promoted');
   }
   // CAS prevents replacing any configuration changed since initial admission.
   stage='switch';await note('switch','intent',next);
   const switched=snapshot(await adapters.route.switch(initial,next.port));
   if(!switched||switched.port!==next.port)return await finish('recovery-required');
   await note('switch','observed',next);
   if(!same(snapshot(await adapters.route.read()),switched))return await finish('recovery-required');
   stage='postcheck';
   if(await adapters.confirm(next)!==true){
    stage='rollback-ready';
    if(!await ready(previous)||!same(snapshot(await adapters.route.read()),switched))return await finish('recovery-required');
    stage='rollback';await note('switch','intent',previous);
    const restored=snapshot(await adapters.route.switch(switched,previous.port));
    if(!restored||restored.port!==previous.port||!same(snapshot(await adapters.route.read()),restored))return await finish('recovery-required');
    await note('switch','observed',previous);
    await note('drain','intent',next);
    if(!same(snapshot(await adapters.route.read()),restored))return await finish('recovery-required');
    if(await adapters.drain(next)!==true)return await finish('recovery-required');
    await note('drain','observed',next);return await finish('rolled-back');
   }
   if(!same(snapshot(await adapters.route.read()),switched))return await finish('recovery-required');
   stage='promote';await note('promote','intent',next);
   if(!same(snapshot(await adapters.route.read()),switched))return await finish('recovery-required');
   if(await adapters.promote(previous,next)!==true)return await finish('recovery-required');
   await note('promote','observed',next);
   if(!same(snapshot(await adapters.route.read()),switched))return await finish('recovery-required');
   stage='drain';await note('drain','intent',previous);
   if(!same(snapshot(await adapters.route.read()),switched))return await finish('recovery-required');
   if(await adapters.drain(previous)!==true)return await finish('complete-old-retained');
   await note('drain','observed',previous);return await finish('complete');
  }catch{
   // Last fsynced intent is the recovery evidence even when result logging fails.
   return {state:mutated?'recovery-required':'not-started',stage,operationId};
  }
 }};
}
