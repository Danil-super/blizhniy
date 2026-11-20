import {request} from 'node:http';

/** One bounded operator request: loopback or a separately validated Unix socket.
 * No redirects/retries and no transport error/body is retained in exceptions. */
export function boundedHandoffRequest(options,{deadlineMs=5000,maxBytes=32768}={}){
 if(typeof window!=='undefined'||!Number.isSafeInteger(deadlineMs)||deadlineMs<1||deadlineMs>30000||!Number.isSafeInteger(maxBytes)||maxBytes<1||maxBytes>4*1024*1024||
  !options||options.protocol!==undefined&&options.protocol!=='http:'||typeof options.path!=='string'||!options.path.startsWith('/')||options.path.startsWith('//')||/[\r\n\\]/.test(options.path)||!['GET','PATCH','POST'].includes(options.method??'GET'))throw new Error('Invalid handoff request');
 if(options.socketPath?typeof options.socketPath!=='string'||!options.socketPath.startsWith('/')||options.port!==undefined:options.hostname!=='127.0.0.1'||!Number.isSafeInteger(options.port)||options.port<1024||options.port>65535)throw new Error('Invalid handoff transport');
 const body=options.body===undefined?undefined:Buffer.from(options.body);
 if(body&&body.length>8192)throw new Error('Invalid handoff body');
 return new Promise((resolve,reject)=>{
  let settled=false,req,timer;
  const fail=()=>{if(settled)return;settled=true;clearTimeout(timer);req?.destroy();reject(new Error('Handoff transport unavailable'));};
  try{
   req=request({...options,body:undefined,agent:false,maxHeaderSize:8192,headers:{...options.headers,connection:'close',...(body?{'content-length':String(body.length)}:{})}},res=>{
    const chunks=[];let bytes=0;
    res.on('data',chunk=>{bytes+=chunk.length;if(bytes>maxBytes||chunks.length>=4096){res.destroy();fail();}else chunks.push(chunk);});
    res.on('error',fail);res.on('aborted',fail);
    res.on('end',()=>{
      if(settled)return;
      if(!res.complete)return fail();
      settled=true;clearTimeout(timer);
      // Caddy can send the configuration ETag in a trailer after the last body chunk.
      const tags=[...(res.headersDistinct.etag??[]),...(res.trailersDistinct.etag??[])];
      resolve({status:res.statusCode,headers:res.headers,etag:tags.length===1?tags[0]:undefined,body:Buffer.concat(chunks,bytes)});
    });
   });
   timer=setTimeout(fail,deadlineMs);req.on('error',fail);req.end(body);
  }catch{fail();}
 });
}
