import {Readable} from 'node:stream';
/** Cancellation must leave the socket open long enough to deliver the JSON boundary error. */
export async function serveLocalUserAccessRequest(req,res,headers,handler,url){
 const controller=new AbortController(),abort=()=>controller.abort();
 req.once('aborted',abort);res.once('close',abort);
 let body,reader,canceled=false;
 try{
  if(!['GET','HEAD'].includes(req.method)){
   const strategy={highWaterMark:4096,size:chunk=>chunk.byteLength};
   reader=Readable.toWeb(req,{strategy}).getReader();
   body=new ReadableStream({
    async pull(output){
     try{const part=await reader.read();if(canceled)return;if(part.done){reader.releaseLock();output.close();}else output.enqueue(part.value);}
     catch{if(!canceled)output.error(Error('Local body unavailable'));}
    },
    cancel(){canceled=true;req.pause();reader.releaseLock();},
   },strategy);
  }
  const request=new Request(url,{method:req.method,headers,signal:controller.signal,...(body?{body,duplex:'half'}:{})});
  const response=await handler(request);
  const responseHeaders=Object.fromEntries(response.headers);responseHeaders.connection='close';
  res.writeHead(response.status,responseHeaders);res.end(Buffer.from(await response.arrayBuffer()));
 }finally{
  if(body&&!body.locked)await body.cancel().catch(()=>{});
  req.removeListener('aborted',abort);if(res.writableFinished)res.removeListener('close',abort);
 }
}
