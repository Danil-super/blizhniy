const unavailable=()=>Error('Local primary services unavailable');
/** Trusted launcher factories must unwind their own partial creation; returned handles are owned here. */
export async function startLocalPrimaryServices({signal,createRefunds,createUserAccess,createProxy,startApplication,startExpiry,onReady}={}){
 if(!(signal instanceof AbortSignal)||signal.aborted||[createProxy,startApplication,startExpiry,onReady].some(fn=>typeof fn!=='function')||
  (createRefunds!==undefined&&typeof createRefunds!=='function')||(createUserAccess!==undefined&&typeof createUserAccess!=='function'))throw unavailable();
 const controller=new AbortController();let refund,userAccess,proxy,app,expiry,failed=false,ready=false,closing,resolveReady,rejectReady,resolveStop;
 const startup=new Promise((resolve,reject)=>{resolveReady=resolve;rejectReady=reject;}),stopped=new Promise(resolve=>{resolveStop=resolve;});
 const stop=()=>{controller.abort();resolveStop();};signal.addEventListener('abort',stop,{once:true});
 const observe=(resource,isRefund)=>resource.done.then(code=>{if(!controller.signal.aborted){failed=isRefund||code!==0;stop();}},()=>{failed=true;stop();});
 const done=(async()=>{
  try{
   if(createRefunds){refund=await createRefunds(controller.signal);observe(refund,true);}controller.signal.throwIfAborted();
   if(createUserAccess){userAccess=await createUserAccess(controller.signal);observe(userAccess,true);}controller.signal.throwIfAborted();
   proxy=await createProxy(refund?.socketPath,controller.signal,userAccess?.socketPath);controller.signal.throwIfAborted();
   app=await startApplication(controller.signal,userAccess?.socketPath);observe(app,false);controller.signal.throwIfAborted();
   expiry=await startExpiry(controller.signal);controller.signal.throwIfAborted();
   await onReady();controller.signal.throwIfAborted();ready=true;resolveReady();await stopped;
  }catch{failed=true;}
  finally{
   stop();
   for(const resource of [userAccess,refund,app,expiry,proxy])try{await resource?.close();}catch{failed=true;}
   signal.removeEventListener('abort',stop);if(!ready)rejectReady(unavailable());
  }
  return failed?1:0;
 })();
 try{await startup;}catch{await done;throw unavailable();}
 return{done,close:()=>closing??=(async()=>{stop();if(await done!==0)throw unavailable();})()};
}
