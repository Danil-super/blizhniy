const directives = ['default-src','script-src','script-src-elem','script-src-attr','style-src','style-src-elem','style-src-attr',
  'img-src','font-src','connect-src','frame-src','worker-src','media-src','manifest-src','object-src','base-uri','form-action','frame-ancestors'] as const;
type ReportEvent = {event:'csp_violation';source:'untrusted-browser';directive:typeof directives[number];disposition:'report'|'enforce';blocked:'inline'|'eval'|'url'|'other'};
class ReportFailure extends Error { constructor(readonly status:number){super('Invalid CSP report');} }
const reply=(status:number)=>new Response(null,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'none'; frame-ancestors 'none'"}});

/** Public, untrusted observations only. No URL/sample/policy/IP/cookie is retained or logged. */
export function createCspReportHandler(config:{origin:string},audit:(event:ReportEvent)=>void=event=>console.info(JSON.stringify(event)),now=Date.now,deadlineMs=1000){
  if(typeof window!=='undefined'||!Number.isInteger(deadlineMs)||deadlineMs<10||deadlineMs>1000)throw new Error('Invalid report runtime');
  let active=0,windowStart=now(),attempts=0;
  const host=new URL(config.origin).host,last=new Map<string,number>(); // At most 18 directives × 2 dispositions.
  return async(request:Request):Promise<Response>=>{
    let admitted=false;
    try{
      if(request.method!=='POST')throw new ReportFailure(405);
      if(request.headers.get('host')!==host||new URL(request.url).search)throw new ReportFailure(403);
      const origin=request.headers.get('origin'),site=request.headers.get('sec-fetch-site');
      if(origin&&origin!==config.origin||site&&site!=='same-origin'||!origin&&site!=='same-origin')throw new ReportFailure(403);
      if(!/^application\/csp-report(?:\s*;\s*charset=utf-8)?$/i.test(request.headers.get('content-type')??''))throw new ReportFailure(415);
      const length=request.headers.get('content-length');
      if(length&&(!/^\d+$/.test(length)||Number(length)>8192))throw new ReportFailure(413);
      if(!request.body)throw new ReportFailure(400);
      const admissionTime=now();if(admissionTime-windowStart>=60000){windowStart=admissionTime;attempts=0;}
      if(active>=4||++attempts>240)throw new ReportFailure(429);active++;admitted=true;
      const reader=request.body.getReader();let complete=false,timer:ReturnType<typeof setTimeout>|undefined,value:unknown;
      try{
        const text=await Promise.race([
          (async()=>{const decoder=new TextDecoder('utf-8',{fatal:true});let bytes=0,chunks=0,text='';for(;;){
            const {done,value}=await reader.read();if(done){complete=true;return text+decoder.decode();}
            bytes+=value.byteLength;if(bytes>8192||++chunks>64)throw new ReportFailure(413);text+=decoder.decode(value,{stream:true});
          }})(),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new ReportFailure(408)),deadlineMs);}),
        ]);
        try{value=JSON.parse(text);}catch{throw new ReportFailure(400);}
      }catch(error){if(error instanceof ReportFailure)throw error;throw new ReportFailure(400);}
      finally{if(timer)clearTimeout(timer);if(!complete)void reader.cancel().catch(()=>{});reader.releaseLock();}
      if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==1||!Object.hasOwn(value,'csp-report'))throw new ReportFailure(400);
      const raw=(value as Record<string,unknown>)['csp-report'];if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new ReportFailure(400);
      const report=raw as Record<string,unknown>,directive=directives.find(item=>item===report['effective-directive']),disposition=report.disposition;
      if(!directive||disposition!=='report'&&disposition!=='enforce')throw new ReportFailure(400);
      const blocked=report['blocked-uri'],category=blocked==='inline'||blocked==='eval'?blocked:typeof blocked==='string'&&/^https?:\/\//.test(blocked)?'url':'other';
      const key=`${directive}:${disposition}`,time=now(),previous=last.get(key);
      if(previous===undefined||time-previous>=60000){audit({event:'csp_violation',source:'untrusted-browser',directive,disposition,blocked:category});last.set(key,time);}
      return reply(204);
    }catch(error){return reply(error instanceof ReportFailure?error.status:503);}
    finally{if(admitted)active--;}
  };
}
