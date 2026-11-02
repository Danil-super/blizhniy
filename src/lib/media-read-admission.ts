type Admission = {reads:number};
type Release = ()=>void;
type Job = {grant:()=>void;expire:()=>void};
type Scheduler = {waiting:number;clients:Map<string,Job[]>;turns:string[];pump:()=>void};
// Next can load this module in several route bundles. The counter AND its queue
// must be shared; separate schedulers would not wake each other's waiters.
const shared=globalThis as typeof globalThis&{blizhniyMediaReadSchedulers?:WeakMap<Admission,Scheduler>};
const schedulers=shared.blizhniyMediaReadSchedulers??=new WeakMap<Admission,Scheduler>();
function scheduler(admission:Admission):Scheduler{
 const existing=schedulers.get(admission);if(existing)return existing;
 const state:Scheduler={waiting:0,clients:new Map(),turns:[],pump:()=>{
  while(admission.reads<4&&state.turns.length){
   const client=state.turns.shift()!,queue=state.clients.get(client)!,job=queue.shift()!;
   state.waiting--;if(queue.length)state.turns.push(client);else state.clients.delete(client);
   job.grant();
  }
 }};
 schedulers.set(admission,state);return state;
}
/** One process, four physical reads; no bytes or authority snapshots in the queue. */
export async function acquireMediaReadSlot(admission:Admission,client:string,signal:AbortSignal):Promise<Release|undefined>{
 signal.throwIfAborted();const state=scheduler(admission);
 const reserve=():Release=>{
  admission.reads++;let released=false;
  return()=>{if(!released){released=true;admission.reads--;state.pump();}};
 };
 if(!state.waiting&&admission.reads<4)return reserve();
 if(state.waiting>=64||(state.clients.get(client)?.length??0)>=24)return;
 return new Promise((resolve,reject)=>{
  let pending=true;const deadline=performance.now()+1500;
  const cleanup=()=>{clearTimeout(timer);signal.removeEventListener('abort',abort);};
  const remove=()=>{
   const queue=state.clients.get(client),index=queue?.indexOf(job)??-1;
   if(index<0)return;
   queue!.splice(index,1);state.waiting--;
   if(!queue!.length){state.clients.delete(client);state.turns.splice(state.turns.indexOf(client),1);}
  };
  const job:Job={grant:()=>{if(!pending)return;pending=false;cleanup();resolve(performance.now()<deadline?reserve():undefined);},
   expire:()=>{if(!pending)return;pending=false;remove();cleanup();resolve(undefined);state.pump();}};
  const abort=()=>{if(!pending)return;pending=false;remove();cleanup();reject(signal.reason);state.pump();};
  const timer=setTimeout(job.expire,1500);
  let queue=state.clients.get(client);if(!queue){queue=[];state.clients.set(client,queue);state.turns.push(client);}
  queue.push(job);state.waiting++;signal.addEventListener('abort',abort,{once:true});
  // A custom signal or a future asynchronous caller must not retain a missed abort.
  if(signal.aborted)abort();else state.pump();
 });
}
